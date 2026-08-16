import type {
  ProjectStatus,
  SourceType,
  UploadIntentInput,
  UploadSession,
} from "@motionprep/contracts";
import type { IdempotencyStore } from "../idempotency/idempotency-store.js";
import { requestFingerprint } from "../idempotency/request-fingerprint.js";
import type { SourceVersionRepository } from "../sources/source-version-repository.js";
import { formatUploadMebibytes } from "./upload-limits.js";
import type { UploadRepository } from "./upload-repository.js";

type UploadIntentErrorCode =
  | "ACTIVE_UPLOAD_EXISTS"
  | "IDEMPOTENCY_CONFLICT"
  | "UPLOAD_REQUEST_IN_PROGRESS"
  | "UPLOAD_SIZE_MISMATCH";

export interface UploadIntentContext {
  repository: UploadRepository;
  sourceVersions: SourceVersionRepository | undefined;
  idempotency: IdempotencyStore;
  now: () => Date;
  limitFor: (contentType: SourceType) => number;
  cancelSession: (session: UploadSession) => Promise<UploadSession>;
  domainError: (code: UploadIntentErrorCode, message: string) => Error;
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

export async function createUploadIntent(
  context: UploadIntentContext,
  input: UploadIntentInput,
  idempotencyKey: string,
  projectStatusBeforeUpload?: ProjectStatus,
): Promise<UploadSession> {
  const uploadLimit = context.limitFor(input.contentType);
  if (input.sizeBytes > uploadLimit) {
    throw context.domainError(
      "UPLOAD_SIZE_MISMATCH",
      `يتجاوز الملف حد الرفع الحالي ${formatUploadMebibytes(uploadLimit)} MiB.`,
    );
  }
  if (!context.sourceVersions) {
    throw new Error("Source version persistence is required for uploads.");
  }
  const scopedIdempotencyKey = `${input.projectId}:${idempotencyKey}`;
  const uploadId = crypto.randomUUID();
  const claim = await context.idempotency.claimRequest(
    "upload",
    scopedIdempotencyKey,
    uploadId,
    requestFingerprint("upload", input),
    24 * 60 * 60,
  );
  if (claim.outcome === "conflict") {
    throw context.domainError(
      "IDEMPOTENCY_CONFLICT",
      "استُخدم مفتاح منع التكرار نفسه لطلب رفع مختلف.",
    );
  }
  if (claim.outcome === "replayed") {
    const existing = await context.repository.findById(claim.resourceId);
    if (existing) return existing;
    throw context.domainError(
      "UPLOAD_REQUEST_IN_PROGRESS",
      "طلب الرفع المطابق ما زال قيد الإنشاء. أعد المحاولة بعد لحظات.",
    );
  }

  const expiredAt = context.now().toISOString();
  const expired = await context.repository.findExpiredActiveByProject(
    input.projectId,
    expiredAt,
  );
  const expiredBaseline = expired[0]
    ? await context.repository.findProjectStatusBeforeUpload(expired[0].uploadId)
    : null;
  await Promise.all(expired.map((session) => context.cancelSession(session)));

  const active = await context.repository.findActiveByProject(input.projectId);
  if (active) {
    await context.idempotency.release(
      "upload",
      scopedIdempotencyKey,
      uploadId,
    );
    throw context.domainError(
      "ACTIVE_UPLOAD_EXISTS",
      "يوجد رفع نشط لهذا المشروع. استأنفه أو ألغِه قبل بدء رفع جديد.",
    );
  }

  const timestamp = context.now();
  const expiresAt = new Date(timestamp.getTime() + 10 * 60_000).toISOString();
  let sourceVersion;
  try {
    sourceVersion = await context.sourceVersions.create({
      projectId: input.projectId,
      uploadId,
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });
  } catch (error) {
    await context.idempotency.release(
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
    maxBytes: uploadLimit,
    uploadUrl: `/v1/uploads/${uploadId}/content`,
    createdAt: timestamp.toISOString(),
    updatedAt: timestamp.toISOString(),
  };

  try {
    const effectiveProjectStatusBeforeUpload =
      expiredBaseline ??
      (projectStatusBeforeUpload === "uploading"
        ? input.replaceSourceVersion === true
          ? "needs_review"
          : "draft"
        : projectStatusBeforeUpload);
    await context.repository.save(session, {
      ...(effectiveProjectStatusBeforeUpload === undefined
        ? {}
        : {
            projectStatusBeforeUpload:
              effectiveProjectStatusBeforeUpload,
          }),
    });
    return session;
  } catch (error) {
    await context.sourceVersions.update(sourceVersion.id, {
      status: "failed",
    });
    await context.idempotency.release(
      "upload",
      scopedIdempotencyKey,
      uploadId,
    );
    throw error;
  }
}
