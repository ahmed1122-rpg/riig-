import { createHash } from "node:crypto";
import { supportsExportFormat } from "@motionprep/contracts";
import type {
  ExportJob,
  ExportRequest,
  ProjectKind,
  TraceContext,
} from "@motionprep/contracts";
import {
  ExportAdapterError,
} from "@motionprep/export-adapters";
import { validateProductionDocument } from "@motionprep/presets";
import {
  InMemoryIdempotencyStore,
  type IdempotencyStore,
} from "../idempotency/idempotency-store.js";
import { startLeaseHeartbeat } from "../jobs/lease-heartbeat.js";
import type { LayerDocumentRepository } from "../processing/processing-repository.js";
import type {
  ObjectStorage,
  StoredObject,
  StoredObjectStream,
} from "../storage/object-storage.js";
import type { UploadRepository } from "../uploads/upload-repository.js";
import type { ExportRepository } from "./export-repository.js";
import type { GeneratedArtifact } from "./export-artifact-helpers.js";
import { ExportArtifactBuilder } from "./export-artifact-builder.js";
import {
  ExportArtifactReader,
  exportArtifactKey,
} from "./export-artifact-reader.js";
import { ExportDomainError, ExportExecutionError } from "./export-errors.js";

export { ExportDomainError, ExportExecutionError } from "./export-errors.js";

export interface ExportClaimLifecycle {
  onClaimed?: (job: ExportJob) => Promise<boolean>;
  onSettled?: (job: ExportJob) => void;
  runClaimed?: (
    job: ExportJob,
    run: () => Promise<ExportJob>,
  ) => Promise<ExportJob>;
}

export class ExportService {
  constructor(
    private readonly repository: ExportRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly idempotency: IdempotencyStore =
      new InMemoryIdempotencyStore(),
    private readonly uploads?: UploadRepository,
    private readonly storage?: ObjectStorage,
    private readonly layerDocuments?: LayerDocumentRepository,
    private readonly executeInline = true,
  ) {}

  async create(
    input: ExportRequest,
    projectKind: ProjectKind,
    idempotencyKey: string,
    onQueued?: (job: ExportJob) => Promise<boolean>,
    correlationId?: string,
    traceContext?: TraceContext,
  ): Promise<ExportJob> {
    if (input.scale !== 1 || input.colorProfile !== "sRGB") {
      throw new ExportDomainError(
        "EXPORT_OPTION_UNSUPPORTED",
        "الإصدار الحالي يحافظ على الدقة الأصلية وملف sRGB فقط.",
      );
    }
    if (!supportsExportFormat(projectKind, input.format)) {
      throw new ExportDomainError(
        "EXPORT_FORMAT_UNSUPPORTED",
        "محول صيغة التصدير المطلوبة غير متاح بعد لهذا النوع من المشاريع.",
      );
    }
    if (
      projectKind === "image" &&
      (input.scope === "per-page" || input.scope === "selected-page")
    ) {
      throw new ExportDomainError(
        "EXPORT_SCOPE_UNSUPPORTED",
        "نطاق الصفحة متاح لمشاريع PDF فقط.",
      );
    }
    if (
      this.uploads &&
      !(await this.uploads.findReadyBySourceVersion(
        input.projectId,
        input.sourceVersionId,
      ))
    ) {
      throw new ExportDomainError(
        "EXPORT_SOURCE_NOT_READY",
        "نسخة المصدر لا تتبع المشروع أو لم تكتمل جاهزيتها.",
      );
    }

    const scopedIdempotencyKey = `${input.projectId}:${idempotencyKey}`;
    const exportId = crypto.randomUUID();
    const claimedId = await this.idempotency.claim(
      "export",
      scopedIdempotencyKey,
      exportId,
      24 * 60 * 60,
    );
    if (claimedId !== exportId) {
      const existing = await this.repository.findById(claimedId);
      if (existing) return existing;
      throw new ExportDomainError(
        "EXPORT_REQUEST_IN_PROGRESS",
        "طلب التصدير المطابق ما زال قيد الإنشاء. أعد المحاولة بعد لحظات.",
      );
    }

    const timestamp = this.now().toISOString();
    const requestedDocument = this.layerDocuments
      ? await this.layerDocuments.findBySource(
          input.projectId,
          input.sourceVersionId,
        )
      : null;
    if (
      input.documentRevision !== undefined &&
      (!requestedDocument ||
        (requestedDocument.revision ?? 1) !== input.documentRevision)
    ) {
      await this.idempotency.release(
        "export",
        scopedIdempotencyKey,
        exportId,
      );
      throw new ExportDomainError(
        "EXPORT_DOCUMENT_REVISION_CONFLICT",
        "تغيرت وثيقة الطبقات قبل بدء التصدير. احفظ أحدث مراجعة ثم أعد المحاولة.",
      );
    }
    const documentRevision =
      input.documentRevision ?? requestedDocument?.revision ?? 1;
    const job: ExportJob = {
      id: exportId,
      ...(correlationId ? { correlationId } : {}),
      ...(traceContext ? { traceContext } : {}),
      projectId: input.projectId,
      sourceVersionId: input.sourceVersionId,
      documentRevision,
      projectKind,
      format: input.format,
      scope: input.scope,
      ...(input.selectedPage === undefined
        ? {}
        : { selectedPage: input.selectedPage }),
      scale: input.scale,
      colorProfile: input.colorProfile,
      namingPresetId: input.namingPresetId,
      status: "queued",
      progress: 0,
      attempt: 0,
      maxAttempts: 3,
      nextAttemptAt: timestamp,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    try {
      await this.repository.save(job);
      if (onQueued && !(await onQueued(job))) {
        throw new ExportDomainError(
          "EXPORT_SOURCE_NOT_CURRENT",
          "تغير إصدار المصدر الحالي قبل إدخال التصدير إلى الطابور.",
          job.id,
        );
      }
      if (!this.executeInline) return job;
      return await this.generateArtifact(
        job,
        projectKind,
        input.namingPresetId,
      );
    } catch (error) {
      const current = await this.repository.findById(exportId);
      if (current && !["ready", "cancelled"].includes(current.status)) {
        await this.fail(current, exportErrorCode(error));
      }
      await this.idempotency.release(
        "export",
        scopedIdempotencyKey,
        exportId,
      );
      if (error instanceof ExportDomainError) {
        throw new ExportDomainError(error.code, error.message, exportId);
      }
      throw new ExportExecutionError(
        error instanceof Error ? error.message : "تعذر تجهيز مهمة التصدير.",
        exportId,
        error,
      );
    }
  }

  async artifact(id: string): Promise<StoredObject> {
    return new ExportArtifactReader(this.storage, this.now).read(
      await this.find(id),
    );
  }

  async artifactStream(
    id: string,
    signal?: AbortSignal,
  ): Promise<StoredObjectStream> {
    return new ExportArtifactReader(this.storage, this.now).stream(
      await this.find(id),
      signal,
    );
  }

  async find(id: string): Promise<ExportJob> {
    const job = await this.repository.findById(id);
    if (!job) {
      throw new ExportDomainError(
        "EXPORT_NOT_FOUND",
        "مهمة التصدير غير موجودة.",
      );
    }
    return job;
  }

  async listByProjectIds(projectIds: string[]): Promise<ExportJob[]> {
    return this.repository.listByProjectIds(projectIds);
  }

  async cancel(id: string): Promise<ExportJob> {
    const job = await this.find(id);
    if (job.status === "cancelled") return job;
    if (
      job.status === "ready" ||
      job.status === "verifying" ||
      job.status === "failed"
    ) {
      throw new ExportDomainError(
        "EXPORT_NOT_CANCELLABLE",
        "لا يمكن إلغاء مهمة التصدير في حالتها الحالية.",
      );
    }
    const cancelled = await this.repository.requestCancel(
      id,
      this.now().toISOString(),
    );
    if (!cancelled || cancelled.status !== "cancelled") {
      throw new ExportDomainError(
        "EXPORT_NOT_CANCELLABLE",
        "لا يمكن إلغاء مهمة التصدير بعد دخولها مرحلة التحقق النهائية.",
      );
    }
    return cancelled;
  }

  async claimAndProcess(
    workerId: string,
    leaseMilliseconds = 5 * 60_000,
    lifecycle: ExportClaimLifecycle = {},
  ): Promise<ExportJob | null> {
    const claimedAt = this.now();
    const job = await this.repository.claimNext(
      workerId,
      claimedAt.toISOString(),
      new Date(claimedAt.getTime() + leaseMilliseconds).toISOString(),
    );
    if (!job) return null;
    if (lifecycle.onClaimed && !(await lifecycle.onClaimed(job))) {
      return this.repository.findById(job.id);
    }
    const heartbeat = startLeaseHeartbeat(async () => {
      const heartbeatAt = this.now();
      const updated = await this.repository.updateClaim(
        job.id,
        workerId,
        {
          leaseExpiresAt: new Date(
            heartbeatAt.getTime() + leaseMilliseconds,
          ).toISOString(),
        },
        heartbeatAt.toISOString(),
      );
      return Boolean(updated);
    }, leaseMilliseconds);
    try {
      const run = () =>
        this.generateArtifact(
          job,
          job.projectKind,
          job.namingPresetId,
          workerId,
        );
      const completed = lifecycle.runClaimed
        ? await lifecycle.runClaimed(job, run)
        : await run();
      if (heartbeat.leaseLost() && completed.status !== "ready") {
        throw new ExportLeaseLostError();
      }
      return completed;
    } catch (error) {
      if (error instanceof ExportLeaseLostError) {
        return this.repository.findById(job.id);
      }
      const now = this.now();
      if (error instanceof ExportDomainError) {
        return (
          (await this.repository.updateClaim(
            job.id,
            workerId,
            {
              status: "failed",
              errorCode: error.code,
              leaseOwner: null,
              leaseExpiresAt: null,
            },
            now.toISOString(),
          )) ?? this.repository.findById(job.id)
        );
      }
      const retryDelay = Math.min(60_000, 2 ** job.attempt * 1_000);
      return (
        (await this.repository.retryOrFailClaim(
          job.id,
          workerId,
          exportErrorCode(error),
          new Date(now.getTime() + retryDelay).toISOString(),
          now.toISOString(),
        )) ?? this.repository.findById(job.id)
      );
    } finally {
      heartbeat.stop();
      lifecycle.onSettled?.(job);
    }
  }

  private async generateArtifact(
    job: ExportJob,
    projectKind: ProjectKind,
    namingPresetId: string,
    workerId?: string,
  ): Promise<ExportJob> {
    if (!this.storage || !this.layerDocuments) {
      throw new Error("Object storage and LayerDocument persistence are required.");
    }
    const document = await this.layerDocuments.findBySource(
      job.projectId,
      job.sourceVersionId,
    );
    if (!document) {
      throw new ExportDomainError(
        "EXPORT_DOCUMENT_NOT_READY",
        "يجب إكمال معالجة وثيقة الطبقات قبل التصدير.",
      );
    }
    if (
      job.documentRevision !== undefined &&
      (document.revision ?? 1) !== job.documentRevision
    ) {
      throw new ExportDomainError(
        "EXPORT_DOCUMENT_REVISION_CONFLICT",
        "تغيرت وثيقة الطبقات بعد إنشاء مهمة التصدير. أنشئ تصديرًا جديدًا من أحدث مراجعة.",
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
      ).create(
        job,
        projectKind,
        document,
        namingPresetId,
      );
    } catch (error) {
      if (error instanceof ExportAdapterError) {
        throw new ExportDomainError(
          "EXPORT_PREFLIGHT_FAILED",
          error.message,
        );
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
    const ready: ExportJob = {
      ...verifying,
      status: "ready",
      progress: 100,
      updatedAt: this.now().toISOString(),
      artifact: {
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
      key: exportArtifactKey(ready),
      contentType: artifact.contentType,
      sizeBytes: artifact.body.byteLength,
      body: artifact.body,
    });
    if (!workerId) {
      await this.repository.save(ready);
      return ready;
    }
    const persisted = await this.repository.updateClaim(
      ready.id,
      workerId,
      ready,
      ready.updatedAt,
    );
    if (!persisted) {
      await this.storage.delete(exportArtifactKey(ready));
      throw new ExportLeaseLostError();
    }
    return persisted;
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

  private async fail(job: ExportJob, errorCode: string): Promise<void> {
    await this.repository.save({
      ...job,
      status: "failed",
      errorCode,
      updatedAt: this.now().toISOString(),
    });
  }
}

class ExportLeaseLostError extends Error {
  constructor() {
    super("Export job lease was lost or the job was cancelled.");
  }
}

function exportErrorCode(error: unknown): string {
  if (error instanceof ExportDomainError) return error.code;
  if (error instanceof ExportAdapterError) return error.code;
  return "EXPORT_WORKER_FAILED";
}
