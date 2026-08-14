import { supportsExportFormat } from "@motionprep/contracts";
import type {
  ExportJob,
  ExportRequest,
  LayerDocument,
  ProjectKind,
  TraceContext,
} from "@motionprep/contracts";
import {
  ExportAdapterError,
} from "@motionprep/export-adapters";
import {
  InMemoryIdempotencyStore,
  type IdempotencyStore,
} from "../idempotency/idempotency-store.js";
import { requestFingerprint } from "../idempotency/request-fingerprint.js";
import { startLeaseHeartbeat } from "../jobs/lease-heartbeat.js";
import type { LayerDocumentRepository } from "../processing/processing-repository.js";
import type {
  ObjectStorage,
  StoredObject,
  StoredObjectStream,
} from "../storage/object-storage.js";
import type { UploadRepository } from "../uploads/upload-repository.js";
import type { ExportRepository } from "./export-repository.js";
import {
  ExportArtifactProcessor,
  ExportLeaseLostError,
} from "./export-artifact-processor.js";
import { ExportArtifactReader } from "./export-artifact-reader.js";
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
  readonly #artifactProcessor: ExportArtifactProcessor;

  constructor(
    private readonly repository: ExportRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly idempotency: IdempotencyStore =
      new InMemoryIdempotencyStore(),
    private readonly uploads?: UploadRepository,
    private readonly storage?: ObjectStorage,
    private readonly layerDocuments?: LayerDocumentRepository,
    private readonly executeInline = true,
    private readonly onArtifactCleanupError?: (
      error: unknown,
      objectKey: string,
    ) => void,
  ) {
    this.#artifactProcessor = new ExportArtifactProcessor(
      repository,
      now,
      uploads,
      storage,
      layerDocuments,
      onArtifactCleanupError,
    );
  }

  async create(
    input: ExportRequest,
    projectKind: ProjectKind,
    idempotencyKey: string,
    onQueued?: (job: ExportJob) => Promise<boolean>,
    correlationId?: string,
    traceContext?: TraceContext,
    reviewApproved = true,
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
    if (!reviewApproved) {
      throw new ExportDomainError(
        "REVIEW_APPROVAL_REQUIRED",
        "اعتمد مراجعة أحدث إصدار من وثيقة الطبقات قبل التصدير.",
      );
    }

    const scopedIdempotencyKey = `${input.projectId}:${idempotencyKey}`;
    const exportId = crypto.randomUUID();
    const claim = await this.idempotency.claimRequest(
      "export",
      scopedIdempotencyKey,
      exportId,
      requestFingerprint("export", { input, projectKind }),
      24 * 60 * 60,
    );
    if (claim.outcome === "conflict") {
      throw new ExportDomainError(
        "IDEMPOTENCY_CONFLICT",
        "استُخدم مفتاح منع التكرار نفسه لطلب تصدير مختلف.",
      );
    }
    if (claim.outcome === "replayed") {
      const existing = await this.repository.findById(claim.resourceId);
      if (existing) return existing;
      throw new ExportDomainError(
        "EXPORT_REQUEST_IN_PROGRESS",
        "طلب التصدير المطابق ما زال قيد الإنشاء. أعد المحاولة بعد لحظات.",
      );
    }

    const timestamp = this.now().toISOString();
    let requestedDocument: LayerDocument | null;
    let enqueued = false;
    try {
      requestedDocument = this.layerDocuments
        ? await this.layerDocuments.findBySource(
            input.projectId,
            input.sourceVersionId,
          )
        : null;
    } catch (error) {
      await this.idempotency.release(
        "export",
        scopedIdempotencyKey,
        exportId,
      );
      throw error;
    }
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
      const persisted = await this.repository.enqueue(
        job,
        onQueued ? () => onQueued(job) : undefined,
      );
      if (!persisted) {
        throw new ExportDomainError(
          "EXPORT_SOURCE_NOT_CURRENT",
          "تغير إصدار المصدر الحالي قبل إدخال التصدير إلى الطابور.",
          job.id,
        );
      }
      enqueued = true;
      if (!this.executeInline) return job;
      return await this.#artifactProcessor.generate(
        job,
        projectKind,
        input.namingPresetId,
      );
    } catch (error) {
      const current = enqueued
        ? await this.repository.findById(exportId)
        : null;
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
    return new ExportArtifactReader(
      this.storage,
      this.now,
      this.onArtifactCleanupError,
    ).read(await this.find(id));
  }

  async artifactStream(
    id: string,
    signal?: AbortSignal,
  ): Promise<StoredObjectStream> {
    return new ExportArtifactReader(
      this.storage,
      this.now,
      this.onArtifactCleanupError,
    ).stream(await this.find(id), signal);
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

  async listByProjectIds(
    projectIds: string[],
    limit = 200,
  ): Promise<ExportJob[]> {
    return this.repository.listByProjectIds(projectIds, limit);
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
        this.#artifactProcessor.generate(
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
          (await this.repository.settleClaim(
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

  private async fail(job: ExportJob, errorCode: string): Promise<void> {
    await this.repository.save({
      ...job,
      status: "failed",
      errorCode,
      updatedAt: this.now().toISOString(),
    });
  }
}

function exportErrorCode(error: unknown): string {
  if (error instanceof ExportDomainError) return error.code;
  if (error instanceof ExportAdapterError) return error.code;
  return "EXPORT_WORKER_FAILED";
}
