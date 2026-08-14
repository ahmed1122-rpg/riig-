import { createHash } from "node:crypto";
import type { ExportJob, ProjectKind } from "@motionprep/contracts";
import { ExportAdapterError } from "@motionprep/export-adapters";
import { validateProductionDocument } from "@motionprep/layer-domain";
import type { LayerDocumentRepository } from "../processing/processing-repository.js";
import type { ObjectStorage } from "../storage/object-storage.js";
import type { UploadRepository } from "../uploads/upload-repository.js";
import { ExportArtifactBuilder } from "./export-artifact-builder.js";
import type { GeneratedArtifact } from "./export-artifact-helpers.js";
import { exportArtifactGenerationKey } from "./export-artifact-reader.js";
import { ExportDomainError } from "./export-errors.js";
import type { ExportRepository } from "./export-repository.js";

export class ExportArtifactProcessor {
  constructor(
    private readonly repository: ExportRepository,
    private readonly now: () => Date,
    private readonly uploads?: UploadRepository,
    private readonly storage?: ObjectStorage,
    private readonly layerDocuments?: LayerDocumentRepository,
    private readonly onCleanupError?: (
      error: unknown,
      objectKey: string,
    ) => void,
  ) {}

  async generate(
    job: ExportJob,
    projectKind: ProjectKind,
    namingPresetId: string,
    workerId?: string,
  ): Promise<ExportJob> {
    if (!this.storage || !this.layerDocuments) {
      throw new Error("Object storage and LayerDocument persistence are required.");
    }
    const document =
      job.documentRevision === undefined
        ? await this.layerDocuments.findBySource(
            job.projectId,
            job.sourceVersionId,
          )
        : await this.layerDocuments.findRevision(
            job.projectId,
            job.sourceVersionId,
            job.documentRevision,
          );
    if (!document) {
      throw new ExportDomainError(
        "EXPORT_DOCUMENT_NOT_READY",
        job.documentRevision === undefined
          ? "يجب إكمال معالجة وثيقة الطبقات قبل التصدير."
          : "تعذر العثور على مراجعة وثيقة الطبقات المثبتة لهذه المهمة.",
      );
    }
    const issues = validateProductionDocument(document, projectKind);
    if (issues.length > 0) {
      throw new ExportDomainError(
        "EXPORT_PREFLIGHT_FAILED",
        issues[0]?.message ?? "فشل فحص وثيقة الطبقات.",
      );
    }

    const generating = await this.transition(
      job,
      "generating",
      35,
      workerId,
    );
    let artifact: GeneratedArtifact;
    try {
      artifact = await new ExportArtifactBuilder(
        this.uploads,
        this.storage,
      ).create(job, projectKind, document, namingPresetId);
    } catch (error) {
      if (error instanceof ExportAdapterError) {
        throw new ExportDomainError("EXPORT_PREFLIGHT_FAILED", error.message);
      }
      throw error;
    }
    const verifying = await this.transition(
      generating,
      "verifying",
      90,
      workerId,
    );
    const expiresAt = new Date(
      this.now().getTime() + 24 * 60 * 60_000,
    ).toISOString();
    const attemptObjectKey = exportArtifactGenerationKey(
      job,
      crypto.randomUUID(),
      artifact.filename,
    );
    const ready: ExportJob = {
      ...verifying,
      status: "ready",
      progress: 100,
      updatedAt: this.now().toISOString(),
      artifact: {
        objectKey: attemptObjectKey,
        filename: artifact.filename,
        sizeBytes: artifact.body.byteLength,
        sha256: createHash("sha256").update(artifact.body).digest("hex"),
        expiresAt,
      },
      leaseOwner: workerId ? null : verifying.leaseOwner,
      leaseExpiresAt: workerId ? null : verifying.leaseExpiresAt,
      errorCode: null,
    };
    await this.storage.put({
      key: attemptObjectKey,
      contentType: artifact.contentType,
      sizeBytes: artifact.body.byteLength,
      body: artifact.body,
    });
    try {
      if (!workerId) {
        await this.repository.save(ready);
        return ready;
      }
      const persisted = await this.repository.settleClaim(
        ready.id,
        workerId,
        ready,
        ready.updatedAt,
      );
      if (!persisted) {
        await this.cleanupAttemptArtifact(attemptObjectKey);
        throw new ExportLeaseLostError();
      }
      return persisted;
    } catch (error) {
      if (error instanceof ExportLeaseLostError) throw error;

      // A client can reject after PostgreSQL committed the update. Resolve
      // that ambiguous outcome before deleting this immutable generation.
      let current: ExportJob | null;
      try {
        current = await this.repository.findById(ready.id);
      } catch {
        throw error;
      }
      if (
        current?.status === "ready" &&
        current.artifact?.objectKey === attemptObjectKey
      ) {
        return current;
      }
      await this.cleanupAttemptArtifact(attemptObjectKey);
      throw error;
    }
  }

  private async cleanupAttemptArtifact(objectKey: string): Promise<void> {
    try {
      await this.storage?.purge([objectKey], []);
    } catch (error) {
      // Cleanup is best-effort because the lease/finalization failure remains
      // authoritative, but orphaned objects must stay observable to operators.
      try {
        this.onCleanupError?.(error, objectKey);
      } catch {
        // An observer must never replace the durable job outcome.
      }
    }
  }

  private async transition(
    job: ExportJob,
    status: ExportJob["status"],
    progress: number,
    workerId?: string,
  ): Promise<ExportJob> {
    const updated = {
      ...job,
      status,
      progress,
      updatedAt: this.now().toISOString(),
    };
    if (!workerId) {
      await this.repository.save(updated);
      return updated;
    }
    const persisted = await this.repository.updateClaim(
      job.id,
      workerId,
      { status, progress },
      updated.updatedAt,
    );
    if (!persisted) throw new ExportLeaseLostError();
    return persisted;
  }
}

export class ExportLeaseLostError extends Error {
  constructor() {
    super("Export job lease was lost or the job was cancelled.");
  }
}
