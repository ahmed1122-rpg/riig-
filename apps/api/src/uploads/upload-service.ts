import {
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  type ProjectStatus,
  type SourceType,
  type UploadIntentInput,
  type UploadSession,
} from "@motionprep/contracts";
import {
  InMemoryIdempotencyStore,
  type IdempotencyStore,
} from "../idempotency/idempotency-store.js";
import type { UploadRepository } from "./upload-repository.js";
import {
  ObjectStorageIntegrityError,
  type ObjectStorage,
  type StoredObjectMetadata,
} from "../storage/object-storage.js";
import { inspectSource } from "./source-inspection.js";
import type { SourceVersionRepository } from "../sources/source-version-repository.js";
import type { UploadFinalizationCommand } from "./upload-finalization.js";
import type {
  UploadIntegrityFailureCode,
  UploadIntegrityFailureCommand,
} from "./upload-integrity-failure.js";
import { classifyUploadIntegrityFailure } from "./upload-integrity.js";
import { resolveUploadFinalizationOutcome } from "./upload-finalization-recovery.js";
import {
  assertImageUploadLimit,
  assertUploadLimit,
  formatUploadMebibytes,
  uploadLimitForSourceType,
} from "./upload-limits.js";
import type { UploadCancellationCommand } from "./upload-cancellation.js";
import type { PreparedUploadContent } from "./upload-content.js";
import { createUploadIntent } from "./upload-intent-coordinator.js";
import type { UploadScanQueueCommand } from "./upload-scan-queue.js";

export class UploadDomainError extends Error {
  constructor(
    readonly code:
      | "ACTIVE_UPLOAD_EXISTS"
      | "UPLOAD_NOT_FOUND"
      | "UPLOAD_NOT_COMPLETABLE"
      | "UPLOAD_SIZE_MISMATCH"
      | "UPLOAD_TYPE_MISMATCH"
      | "UPLOAD_HASH_INVALID"
      | "UPLOAD_CONTENT_INVALID"
      | "UPLOAD_STORAGE_MISMATCH"
      | "UPLOAD_REQUEST_IN_PROGRESS"
      | "IDEMPOTENCY_CONFLICT",
    message: string,
  ) {
    super(message);
  }
}

export class UploadService {
  constructor(
    private readonly repository: UploadRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly idempotency: IdempotencyStore =
      new InMemoryIdempotencyStore(),
    private readonly storage?: ObjectStorage,
    private readonly sourceVersions?: SourceVersionRepository,
    private readonly finalization?: UploadFinalizationCommand,
    private readonly maxUploadBytes = MAX_UPLOAD_BYTES,
    private readonly integrityFailures?: UploadIntegrityFailureCommand,
    private readonly cancellations?: UploadCancellationCommand,
    private readonly onOperationalError?: (
      error: unknown,
      context: {
        stage:
          | "repository_read"
          | "storage_inspect"
          | "integrity_failure_record"
          | "object_cleanup"
          | "failure_transition";
        uploadId: string;
        objectKey: string;
      },
    ) => void,
    private readonly maxImageUploadBytes = MAX_IMAGE_UPLOAD_BYTES,
    private readonly scanQueue?: UploadScanQueueCommand,
  ) {
    assertUploadLimit(maxUploadBytes);
    assertImageUploadLimit(maxImageUploadBytes);
  }

  private limitFor(contentType: SourceType): number {
    return uploadLimitForSourceType(
      contentType,
      this.maxUploadBytes,
      this.maxImageUploadBytes,
    );
  }

  async receive(
    uploadId: string,
    content: Buffer | PreparedUploadContent,
  ): Promise<UploadSession> {
    const session = await this.requireSession(uploadId);
    if (session.status === "ready") return this.reconcileReady(session);
    if (session.status === "scanning") return session;
    if (session.status !== "uploading") {
      throw new UploadDomainError(
        "UPLOAD_NOT_COMPLETABLE",
        "لا يمكن استقبال الملف في حالة الرفع الحالية.",
      );
    }

    const inspection = Buffer.isBuffer(content)
      ? inspectSource(content)
      : content.detectedContentType
        ? {
            contentType: content.detectedContentType,
            sizeBytes: content.sizeBytes,
            sha256: content.sha256,
          }
        : null;
    if (!inspection) {
      await this.fail(session);
      throw new UploadDomainError(
        "UPLOAD_CONTENT_INVALID",
        "تعذر التحقق من بنية الملف. الملف تالف أو نوعه غير مدعوم.",
      );
    }

    if (!this.storage) {
      throw new Error("Object storage is required for binary uploads.");
    }

    const uploadLimit = this.limitFor(session.contentType);
    if (
      inspection.contentType !== session.contentType ||
      inspection.sizeBytes !== session.expectedSizeBytes ||
      inspection.sizeBytes > uploadLimit
    ) {
      await this.fail(session);
      throw new UploadDomainError(
        inspection.contentType !== session.contentType
          ? "UPLOAD_TYPE_MISMATCH"
          : "UPLOAD_SIZE_MISMATCH",
        inspection.contentType !== session.contentType
          ? "نوع الملف الفعلي لا يطابق النوع المعلن."
          : `حجم الملف المرفوع لا يطابق الحجم المتوقع أو يتجاوز ${formatUploadMebibytes(uploadLimit)} MiB.`,
      );
    }

    let objectVerified = false;
    try {
      const stored = Buffer.isBuffer(content)
        ? await this.storage.put({
            key: session.objectKey,
            contentType: inspection.contentType,
            sizeBytes: inspection.sizeBytes,
            body: content,
          })
        : await this.storage.putStream({
            key: session.objectKey,
            contentType: inspection.contentType,
            sizeBytes: inspection.sizeBytes,
            sha256: inspection.sha256,
            body: content.openStream(),
          });
      if (
        stored.key !== session.objectKey ||
        stored.contentType !== inspection.contentType ||
        stored.sizeBytes !== inspection.sizeBytes ||
        stored.sha256 !== inspection.sha256
      ) {
        throw new UploadDomainError(
          "UPLOAD_STORAGE_MISMATCH",
          "تعذر إثبات سلامة الملف بعد تخزينه. أعد الرفع لاحقًا.",
        );
      }
      objectVerified = true;
      return await this.completeVerified(session, inspection.sha256);
    } catch (error) {
      if (objectVerified && this.finalization) {
        const resolution = await resolveUploadFinalizationOutcome({
          attempted: session,
          expectedSha256: inspection.sha256,
          uploads: this.repository,
          storage: this.storage,
          ...(this.integrityFailures
            ? { integrityFailures: this.integrityFailures }
            : {}),
          onObservationError: (recoveryError, stage) => {
            this.reportOperationalError(recoveryError, session, stage);
          },
        });
        if (resolution.kind === "published") return resolution.session;
        if (resolution.kind === "unknown") throw error;
      }
      try {
        await this.storage.purge([session.objectKey], []);
      } catch (cleanupError) {
        this.reportOperationalError(cleanupError, session, "object_cleanup");
      }
      try {
        await this.fail(session);
      } catch (transitionError) {
        this.reportOperationalError(
          transitionError,
          session,
          "failure_transition",
        );
      }
      throw error;
    }
  }

  private reportOperationalError(
    error: unknown,
    session: UploadSession,
    stage:
      | "repository_read"
      | "storage_inspect"
      | "integrity_failure_record"
      | "object_cleanup"
      | "failure_transition",
  ): void {
    try {
      this.onOperationalError?.(error, {
        stage,
        uploadId: session.uploadId,
        objectKey: session.objectKey,
      });
    } catch {
      // Observability cannot replace the durable upload outcome.
    }
  }

  async createIntent(
    input: UploadIntentInput,
    idempotencyKey: string,
    projectStatusBeforeUpload?: ProjectStatus,
  ): Promise<UploadSession> {
    return createUploadIntent(
      {
        repository: this.repository,
        sourceVersions: this.sourceVersions,
        idempotency: this.idempotency,
        now: this.now,
        limitFor: (contentType) => this.limitFor(contentType),
        cancelSession: (session) => this.cancelSession(session),
        domainError: (code, message) => new UploadDomainError(code, message),
        objectKeyPrefix: this.scanQueue ? "quarantine" : "sources",
      },
      input,
      idempotencyKey,
      projectStatusBeforeUpload,
    );
  }

  private async completeVerified(
    session: UploadSession,
    sha256: string,
  ): Promise<UploadSession> {
    if (this.scanQueue) {
      return this.scanQueue.enqueue({ session, sha256 });
    }
    if (this.finalization) {
      return this.finalization.finalize({ session, sha256 });
    }
    const verifying = this.updated(session, { status: "verifying" });
    await this.repository.save(verifying);
    if (!session.sourceVersionId) {
      await this.fail(session);
      throw new Error("Upload session is missing its source version.");
    }
    await this.sourceVersions?.update(session.sourceVersionId, {
      status: "verifying",
    });

    const ready = this.updated(verifying, {
      status: "ready",
      sha256: sha256.toLowerCase(),
    });
    await this.repository.save(ready);
    await this.sourceVersions?.update(session.sourceVersionId, {
      status: "ready",
      sha256: ready.sha256,
    });
    return ready;
  }

  private async reconcileReady(session: UploadSession): Promise<UploadSession> {
    if (!this.finalization) return session;
    if (!this.storage || !session.sha256) {
      throw new Error("Ready upload is missing durable verification metadata.");
    }
    let stored: StoredObjectMetadata | null;
    try {
      stored = await this.storage.inspect(session.objectKey);
    } catch (error) {
      if (!(error instanceof ObjectStorageIntegrityError)) throw error;
      await this.markIntegrityFailure(
        session,
        "UPLOAD_OBJECT_METADATA_INVALID",
        null,
      );
      throw new UploadDomainError(
        "UPLOAD_STORAGE_MISMATCH",
        "Stored upload metadata failed its integrity check. Upload the source again.",
      );
    }
    const failureCode = classifyUploadIntegrityFailure(session, stored);
    if (failureCode) {
      await this.markIntegrityFailure(session, failureCode, stored);
      throw new UploadDomainError(
        "UPLOAD_STORAGE_MISMATCH",
        "تعذر إثبات سلامة الملف المخزن عند استئناف إتمام الرفع. أعد رفع المصدر.",
      );
    }
    return this.finalization.finalize({
      session,
      sha256: stored!.sha256,
    });
  }

  private async markIntegrityFailure(
    session: UploadSession,
    code: UploadIntegrityFailureCode,
    observed: StoredObjectMetadata | null,
  ): Promise<void> {
    if (this.integrityFailures) {
      await this.integrityFailures.markIntegrityFailure({
        session,
        code,
        observed,
      });
      return;
    }
    await this.fail(session);
  }

  async cancel(uploadId: string): Promise<UploadSession> {
    const session = await this.requireSession(uploadId);
    if (["ready", "rejected", "scan_failed"].includes(session.status)) {
      throw new UploadDomainError(
        "UPLOAD_NOT_COMPLETABLE",
        "وصل الرفع إلى حالة نهائية ولا يمكن إلغاؤه.",
      );
    }

    return this.cancelSession(session);
  }

  async find(uploadId: string): Promise<UploadSession> {
    return this.requireSession(uploadId);
  }

  async findSourceVersion(uploadId: string) {
    const session = await this.requireSession(uploadId);
    if (!session.sourceVersionId) return null;
    return this.sourceVersions?.findById(session.sourceVersionId) ?? null;
  }

  private async requireSession(uploadId: string): Promise<UploadSession> {
    const session = await this.repository.findById(uploadId);
    if (!session) {
      throw new UploadDomainError(
        "UPLOAD_NOT_FOUND",
        "جلسة الرفع غير موجودة.",
      );
    }
    return session;
  }

  private updated(
    session: UploadSession,
    changes: Partial<UploadSession>,
  ): UploadSession {
    return {
      ...session,
      ...changes,
      updatedAt: this.now().toISOString(),
    };
  }

  private async fail(session: UploadSession): Promise<void> {
    await this.repository.save(this.updated(session, { status: "failed" }));
    if (session.sourceVersionId) {
      await this.sourceVersions?.update(session.sourceVersionId, {
        status: "failed",
      });
    }
  }

  private async cancelSession(session: UploadSession): Promise<UploadSession> {
    let cancelled: UploadSession;
    if (this.cancellations) {
      const result = await this.cancellations.cancel({ session });
      if (result.outcome === "already_published") {
        throw new UploadDomainError(
          "UPLOAD_NOT_COMPLETABLE",
          "The upload completed before cancellation acquired the transition lock.",
        );
      }
      if (result.outcome === "stale_session") {
        throw new UploadDomainError(
          "UPLOAD_NOT_COMPLETABLE",
          "Upload metadata changed before cancellation could be applied.",
        );
      }
      cancelled = result.session;
    } else {
      cancelled = this.updated(session, { status: "cancelled" });
      await this.repository.save(cancelled);
      if (session.sourceVersionId) {
        await this.sourceVersions?.update(session.sourceVersionId, {
          status: "cancelled",
        });
      }
    }
    await this.storage?.purge([cancelled.objectKey], []);
    await this.repository.markObjectPurged(
      cancelled.uploadId,
      this.now().toISOString(),
    );
    return cancelled;
  }
}
