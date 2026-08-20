import type {
  ProcessingJob,
  ProjectKind,
  TraceContext,
} from "@motionprep/contracts";
import type { IdempotencyStore } from "../idempotency/idempotency-store.js";
import { requestFingerprint } from "../idempotency/request-fingerprint.js";
import type { UploadRepository } from "../uploads/upload-repository.js";
import type { InlineProcessingRunner } from "./inline-processing-runner.js";
import { ProcessingDomainError } from "./processing-errors.js";
import type { ProcessingJobRepository } from "./processing-repository.js";
import type { ProcessingServiceRuntimeOptions } from "./processing-service-options.js";

export interface ProcessingJobCreationContext {
  jobs: ProcessingJobRepository;
  uploads: UploadRepository;
  idempotency: IdempotencyStore;
  inlineRunner: InlineProcessingRunner;
  now: () => Date;
  executeInline: boolean;
  runtime: ProcessingServiceRuntimeOptions;
}

export async function createAndRunProcessingJob(
  context: ProcessingJobCreationContext,
  projectId: string,
  sourceVersionId: string,
  projectKind: ProjectKind,
  options: ProcessingJob["options"],
  idempotencyKey: string,
  ownerUserId?: string,
  onQueued?: (job: ProcessingJob) => Promise<boolean>,
  correlationId?: string,
  traceContext?: TraceContext,
): Promise<ProcessingJob> {
  const source = await context.uploads.findReadyBySourceVersion(
    projectId,
    sourceVersionId,
  );
  if (!source) {
    throw new ProcessingDomainError(
      "SOURCE_NOT_READY",
      "نسخة المصدر لا تتبع المشروع أو لم تكتمل جاهزيتها.",
    );
  }
  const id = crypto.randomUUID();
  const scopedIdempotencyKey =
    `${projectId}:${sourceVersionId}:${idempotencyKey}`;
  const claim = await context.idempotency.claimRequest(
    "processing",
    scopedIdempotencyKey,
    id,
    requestFingerprint("processing", {
      projectId,
      sourceVersionId,
      projectKind,
      options,
    }),
    24 * 60 * 60,
  );
  if (claim.outcome === "conflict") {
    throw new ProcessingDomainError(
      "IDEMPOTENCY_CONFLICT",
      "استُخدم مفتاح منع التكرار نفسه لطلب معالجة مختلف.",
    );
  }
  if (claim.outcome === "replayed") {
    const repeated = await context.jobs.findById(claim.resourceId);
    if (repeated) return repeated;
    throw new ProcessingDomainError(
      "PROCESSING_IN_PROGRESS",
      "طلب المعالجة المطابق ما زال قيد الإنشاء. أعد المحاولة بعد لحظات.",
    );
  }

  let existing: ProcessingJob | null;
  try {
    existing = await context.jobs.findBySource(projectId, sourceVersionId);
  } catch (error) {
    await context.idempotency.release(
      "processing",
      scopedIdempotencyKey,
      id,
    );
    throw error;
  }
  if (existing) {
    await context.idempotency.release(
      "processing",
      scopedIdempotencyKey,
      id,
    );
    throw new ProcessingDomainError(
      "PROCESSING_IN_PROGRESS",
      "توجد مهمة معالجة نشطة لهذا المصدر. انتظر اكتمالها ثم أعد المحاولة.",
    );
  }

  const timestamp = context.now().toISOString();
  const job: ProcessingJob = {
    id,
    ...(correlationId ? { correlationId } : {}),
    ...(traceContext ? { traceContext } : {}),
    projectId,
    sourceVersionId,
    projectKind,
    options,
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
  let reserved = false;
  let enqueued: boolean;
  try {
    if (ownerUserId && context.runtime.usageMeter) {
      await context.runtime.usageMeter.reserveJob(ownerUserId, job.id);
      reserved = true;
    }
    enqueued = await context.jobs.enqueue(
      job,
      onQueued ? () => onQueued(job) : undefined,
    );
  } catch (error) {
    if (reserved) await context.runtime.usageMeter?.releaseJob(job.id);
    await context.idempotency.release(
      "processing",
      scopedIdempotencyKey,
      job.id,
    );
    throw error;
  }
  if (!enqueued) {
    if (reserved) await context.runtime.usageMeter?.releaseJob(job.id);
    await context.idempotency.release(
      "processing",
      scopedIdempotencyKey,
      job.id,
    );
    throw new ProcessingDomainError(
      "SOURCE_NOT_CURRENT",
      "تغير إصدار المصدر الحالي قبل إدخال المهمة إلى الطابور.",
      job.id,
    );
  }
  if (!context.executeInline) return job;
  const startedAt = Date.now();
  try {
    return await context.inlineRunner.run(job);
  } finally {
    await context.runtime.usageMeter?.recordProcessingSeconds(
      job.id,
      1,
      Math.max(1, Math.ceil((Date.now() - startedAt) / 1_000)),
    );
  }
}
