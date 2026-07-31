import {
  MAX_UPLOAD_BYTES,
  type SourceType,
  type UploadIntentInput,
  type UploadSession,
} from "@motionprep/contracts";
import {
  InMemoryIdempotencyStore,
  type IdempotencyStore,
} from "../idempotency/idempotency-store.js";
import type { UploadRepository } from "./upload-repository.js";
import type { ObjectStorage } from "../storage/object-storage.js";
import { inspectSource } from "./source-inspection.js";
import type { SourceVersionRepository } from "../sources/source-version-repository.js";

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
      | "UPLOAD_REQUEST_IN_PROGRESS",
    message: string,
  ) {
    super(message);
  }
}

function safeExtension(contentType: SourceType): string {
  return {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/tiff": "tiff",
    "image/bmp": "bmp",
    "application/pdf": "pdf",
  }[contentType];
}

export interface CompleteUploadInput {
  observedContentType: SourceType;
  observedSizeBytes: number;
  sha256: string;
}

export class UploadService {
  constructor(
    private readonly repository: UploadRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly idempotency: IdempotencyStore =
      new InMemoryIdempotencyStore(),
    private readonly storage?: ObjectStorage,
    private readonly sourceVersions?: SourceVersionRepository,
  ) {}

  async receive(uploadId: string, bytes: Buffer): Promise<UploadSession> {
    const session = await this.requireSession(uploadId);
    if (session.status === "ready") return session;
    if (session.status !== "uploading") {
      throw new UploadDomainError(
        "UPLOAD_NOT_COMPLETABLE",
        "لا يمكن استقبال الملف في حالة الرفع الحالية.",
      );
    }

    const inspection = inspectSource(bytes);
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

    if (
      inspection.contentType !== session.contentType ||
      inspection.sizeBytes !== session.expectedSizeBytes ||
      inspection.sizeBytes > MAX_UPLOAD_BYTES
    ) {
      await this.fail(session);
      throw new UploadDomainError(
        inspection.contentType !== session.contentType
          ? "UPLOAD_TYPE_MISMATCH"
          : "UPLOAD_SIZE_MISMATCH",
        inspection.contentType !== session.contentType
          ? "نوع الملف الفعلي لا يطابق النوع المعلن."
          : "حجم الملف المرفوع لا يطابق الحجم المتوقع أو يتجاوز 30MB.",
      );
    }

    await this.storage.put({
      key: session.objectKey,
      contentType: inspection.contentType,
      sizeBytes: inspection.sizeBytes,
      body: bytes,
    });

    try {
      return await this.complete(uploadId, {
        observedContentType: inspection.contentType,
        observedSizeBytes: inspection.sizeBytes,
        sha256: inspection.sha256,
      });
    } catch (error) {
      await this.storage.delete(session.objectKey);
      throw error;
    }
  }

  async createIntent(
    input: UploadIntentInput,
    idempotencyKey: string,
  ): Promise<UploadSession> {
    if (!this.sourceVersions) {
      throw new Error("Source version persistence is required for uploads.");
    }
    const scopedIdempotencyKey = `${input.projectId}:${idempotencyKey}`;
    const uploadId = crypto.randomUUID();
    const claimedId = await this.idempotency.claim(
      "upload",
      scopedIdempotencyKey,
      uploadId,
      24 * 60 * 60,
    );
    if (claimedId !== uploadId) {
      const existing = await this.repository.findById(claimedId);
      if (existing) return existing;
      throw new UploadDomainError(
        "UPLOAD_REQUEST_IN_PROGRESS",
        "طلب الرفع المطابق ما زال قيد الإنشاء. أعد المحاولة بعد لحظات.",
      );
    }

    const expiredAt = this.now().toISOString();
    const expired = await this.repository.expireActiveByProject(
      input.projectId,
      expiredAt,
    );
    await Promise.all(
      expired.map(async (session) => {
        if (session.sourceVersionId) {
          await this.sourceVersions?.update(session.sourceVersionId, {
            status: "cancelled",
          });
        }
        await this.storage?.delete(session.objectKey);
      }),
    );

    const active = await this.repository.findActiveByProject(input.projectId);
    if (active) {
      await this.idempotency.release(
        "upload",
        scopedIdempotencyKey,
        uploadId,
      );
      throw new UploadDomainError(
        "ACTIVE_UPLOAD_EXISTS",
        "يوجد رفع نشط لهذا المشروع. استأنفه أو ألغِه قبل بدء رفع جديد.",
      );
    }

    const timestamp = this.now();
    const expiresAt = new Date(timestamp.getTime() + 10 * 60_000).toISOString();
    let sourceVersion;
    try {
      sourceVersion = await this.sourceVersions.create({
        projectId: input.projectId,
        uploadId,
        filename: input.filename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      });
    } catch (error) {
      await this.idempotency.release(
        "upload",
        scopedIdempotencyKey,
        uploadId,
      );
      throw error;
    }
    const session: UploadSession = {
      uploadId,
      projectId: input.projectId,
      filename: input.filename,
      contentType: input.contentType,
      expectedSizeBytes: input.sizeBytes,
      status: "uploading",
      sourceVersionId: sourceVersion.id,
      sha256: null,
      objectKey: `sources/${input.projectId}/${uploadId}.${safeExtension(input.contentType)}`,
      expiresAt,
      maxBytes: MAX_UPLOAD_BYTES,
      uploadUrl: `/v1/uploads/${uploadId}/content`,
      createdAt: timestamp.toISOString(),
      updatedAt: timestamp.toISOString(),
    };

    try {
      await this.repository.save(session);
      return session;
    } catch (error) {
      await this.sourceVersions.update(sourceVersion.id, {
        status: "failed",
      });
      await this.idempotency.release(
        "upload",
        scopedIdempotencyKey,
        uploadId,
      );
      throw error;
    }
  }

  async complete(
    uploadId: string,
    input: CompleteUploadInput,
  ): Promise<UploadSession> {
    const session = await this.requireSession(uploadId);
    if (session.status === "ready") return session;
    if (session.status !== "uploading" && session.status !== "verifying") {
      throw new UploadDomainError(
        "UPLOAD_NOT_COMPLETABLE",
        "لا يمكن إكمال جلسة الرفع في حالتها الحالية.",
      );
    }

    if (input.observedContentType !== session.contentType) {
      await this.fail(session);
      throw new UploadDomainError(
        "UPLOAD_TYPE_MISMATCH",
        "نوع الملف الفعلي لا يطابق النوع المعلن.",
      );
    }

    if (
      input.observedSizeBytes > MAX_UPLOAD_BYTES ||
      input.observedSizeBytes !== session.expectedSizeBytes
    ) {
      await this.fail(session);
      throw new UploadDomainError(
        "UPLOAD_SIZE_MISMATCH",
        "حجم الملف المرفوع لا يطابق الحجم المتوقع أو يتجاوز 30MB.",
      );
    }

    if (!/^[a-f0-9]{64}$/i.test(input.sha256)) {
      throw new UploadDomainError(
        "UPLOAD_HASH_INVALID",
        "بصمة الملف غير صالحة.",
      );
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
      sha256: input.sha256.toLowerCase(),
    });
    await this.repository.save(ready);
    await this.sourceVersions?.update(session.sourceVersionId, {
      status: "ready",
      sha256: ready.sha256,
    });
    return ready;
  }

  async cancel(uploadId: string): Promise<UploadSession> {
    const session = await this.requireSession(uploadId);
    if (session.status === "cancelled") return session;
    if (session.status === "ready") {
      throw new UploadDomainError(
        "UPLOAD_NOT_COMPLETABLE",
        "اكتمل الرفع بالفعل ولا يمكن إلغاؤه.",
      );
    }

    const cancelled = this.updated(session, { status: "cancelled" });
    await this.repository.save(cancelled);
    if (session.sourceVersionId) {
      await this.sourceVersions?.update(session.sourceVersionId, {
        status: "cancelled",
      });
    }
    await this.storage?.delete(session.objectKey);
    return cancelled;
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
}
