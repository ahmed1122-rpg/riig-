import type {
  LayerDocument,
  ProcessingJob,
  ProjectKind,
} from "@motionprep/contracts";
import {
  DocumentProcessingError,
  LocalArabicPdfOcrEngine,
  preparePdfSource,
} from "@motionprep/document-processing";
import {
  MediaProcessingError,
  prepareImageSource,
} from "@motionprep/media-processing";
import { hostname } from "node:os";
import { Pool, type PoolClient } from "pg";
import sharp from "sharp";
import { z } from "zod";
import {
  mapProcessingRow,
  type ProcessingRow,
} from "../infrastructure/postgres/processing-row.js";
import { hasExpectedObjectIntegrity } from "../storage/object-integrity.js";
import { createS3ObjectStorageOptions } from "../storage/object-storage-environment.js";
import { isObjectStorageIntegrityFailure } from "../storage/object-storage.js";
import { S3ObjectStorage } from "../storage/s3-object-storage.js";
import { loadProcessingWorkerConfig } from "./processing-worker-config.js";
import { getProcessingRetryPolicy } from "./processing-worker-policy.js";
import { PostgresUsageMeter } from "../infrastructure/postgres/postgres-usage-meter.js";
import { startLeaseHeartbeat } from "../jobs/lease-heartbeat.js";
import { WorkerDrainCoordinator } from "../jobs/worker-drain.js";
import { releaseProcessingJobForShutdown } from "../jobs/worker-shutdown-requeue.js";
import { startWorkerHeartbeat } from "../observability/worker-heartbeat.js";
import { recordWorkerEvent } from "../observability/worker-events.js";
import { updateProjectStatusForJob } from "../projects/project-job-status.js";
import {
  applyPdfRegionOcr,
  PdfRegionOcrError,
} from "./pdf-region-ocr.js";

const jobOptionsSchema = z.object({
  pdfSeparationMode: z
    .enum(["heading", "topic", "sentence", "line", "word", "character"])
    .default("sentence"),
  pdfRegionOcr: z
    .object({
      pageNumber: z.number().int().positive().max(250),
      start: z.object({
        x: z.number().finite().min(0).max(1),
        y: z.number().finite().min(0).max(1),
      }),
      end: z.object({
        x: z.number().finite().min(0).max(1),
        y: z.number().finite().min(0).max(1),
      }),
      baseRevision: z.number().int().positive(),
      actorUserId: z.string().uuid(),
      operationId: z.string().min(1).max(256),
    })
    .optional(),
});

export interface ProcessingWorkerOptions {
  projectKind: ProjectKind;
  serviceName: "motionprep-worker-media" | "motionprep-worker-document";
}

export async function runProcessingWorker(
  options: ProcessingWorkerOptions,
): Promise<void> {
  const config = loadProcessingWorkerConfig(process.env);
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    application_name: options.serviceName,
  });
  const storage = new S3ObjectStorage(createS3ObjectStorageOptions(config));
  const pdfOcrEngine =
    options.projectKind === "book" && config.PDF_OCR_MODE === "local"
      ? new LocalArabicPdfOcrEngine({
          onProgress: (event) => {
            if (event.progress === 1) {
              log(options.serviceName, "info", "ocr.stage_completed", event);
            }
          },
          onFallback: (event) => {
            log(
              options.serviceName,
              "info",
              "ocr.fallback_selected",
              event,
            );
          },
          onReviewRequired: (review) => {
            log(
              options.serviceName,
              "warning",
              "ocr.review_required",
              { ...review },
            );
          },
        })
      : null;
  const concurrency =
    options.projectKind === "image"
      ? config.PROCESSING_CONCURRENCY
      : config.DOCUMENT_PROCESSING_CONCURRENCY;
  sharp.cache({
    memory: config.SHARP_CACHE_MEMORY_MB,
    files: 0,
    items: Math.max(16, concurrency * 8),
  });
  sharp.concurrency(config.SHARP_CONCURRENCY);
  const instanceId = `${hostname()}:${process.pid}:${crypto.randomUUID()}`;
  const usageMeter = new PostgresUsageMeter(
    pool,
    config.USAGE_METERING_MODE,
  );
  let running = true;
  const drain = new WorkerDrainCoordinator<{
    job: ProcessingJob;
    workerId: string;
  }>({
    timeoutMilliseconds: config.PROCESSING_DRAIN_TIMEOUT_MS,
    release: async ({ job, workerId }) => {
      const released = await releaseProcessingJobForShutdown(
        pool,
        job,
        workerId,
      );
      if (!released) return;
      await recordWorkerEvent(pool, {
        workerType: options.projectKind === "image" ? "media" : "document",
        eventType: "retry",
        jobId: job.id,
      });
      log(options.serviceName, "info", "processing.shutdown_requeued", {
        job_id: job.id,
        worker_id: workerId,
      });
    },
    onReleaseError: (error, { job, workerId }) => {
      log(options.serviceName, "error", "processing.shutdown_requeue_failed", {
        job_id: job.id,
        worker_id: workerId,
        error: error instanceof Error ? error.message : "unknown",
      });
    },
  });

  const requestShutdown = () => {
    if (!running) return;
    running = false;
    log(options.serviceName, "info", "worker.drain_started", {
      active_jobs: drain.activeCount,
      drain_timeout_ms: config.PROCESSING_DRAIN_TIMEOUT_MS,
    });
    drain.requestShutdown();
  };
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);

  try {
    await Promise.all([
      pool.query("SELECT 1"),
      storage.ready(false),
    ]);
    log(options.serviceName, "info", "worker.ready", {
      concurrency,
      lease_ms: config.PROCESSING_LEASE_MS,
      project_kind: options.projectKind,
      sharp_cache_memory_mb: config.SHARP_CACHE_MEMORY_MB,
      sharp_concurrency: config.SHARP_CONCURRENCY,
    });
    const heartbeat = await startWorkerHeartbeat(pool, {
      instanceId,
      workerType: options.projectKind === "image" ? "media" : "document",
      releaseVersion: process.env.RELEASE_VERSION ?? "development",
      concurrency,
    });

    try {
      await Promise.all(
        Array.from({ length: concurrency }, (_, index) =>
          workerLoop({
            pool,
            storage,
            serviceName: options.serviceName,
            projectKind: options.projectKind,
            workerId: `${instanceId}:${index + 1}`,
            leaseMilliseconds: config.PROCESSING_LEASE_MS,
            pollMilliseconds: config.PROCESSING_POLL_MS,
            pdfOcrEngine,
            usageMeter,
            isRunning: () => running,
            onClaimed: (job) =>
              drain.register(`${instanceId}:${index + 1}`, {
                job,
                workerId: `${instanceId}:${index + 1}`,
              }),
            onSettled: () => drain.unregister(`${instanceId}:${index + 1}`),
          }),
        ),
      );
    } finally {
      await heartbeat.stop();
    }
  } finally {
    process.off("SIGINT", requestShutdown);
    process.off("SIGTERM", requestShutdown);
    if (!running) await drain.waitForRelease();
    await pool.end();
    await pdfOcrEngine?.close();
    storage.destroy();
  }
}

interface WorkerLoopContext {
  pool: Pool;
  storage: S3ObjectStorage;
  serviceName: ProcessingWorkerOptions["serviceName"];
  projectKind: ProjectKind;
  workerId: string;
  leaseMilliseconds: number;
  pollMilliseconds: number;
  pdfOcrEngine: LocalArabicPdfOcrEngine | null;
  usageMeter: PostgresUsageMeter;
  isRunning: () => boolean;
  onClaimed: (job: ProcessingJob) => Promise<boolean>;
  onSettled: () => void;
}

async function workerLoop(context: WorkerLoopContext): Promise<void> {
  while (context.isRunning()) {
    let registered = false;
    try {
      const job = await claimNextProcessingJob(
        context.pool,
        context.projectKind,
        context.workerId,
        context.leaseMilliseconds,
      );
      if (!job) {
        await delay(context.pollMilliseconds);
        continue;
      }
      registered = await context.onClaimed(job);
      if (!registered) continue;
      log(context.serviceName, "info", "processing.started", {
        job_id: job.id,
        project_id: job.projectId,
        attempt: job.attempt,
        max_attempts: job.maxAttempts,
      });
      await processClaimedJob(context, job);
      log(context.serviceName, "info", "processing.completed", {
        job_id: job.id,
        project_id: job.projectId,
        attempt: job.attempt,
      });
    } catch (error) {
      log(context.serviceName, "error", "worker.loop_failed", {
        worker_id: context.workerId,
        error: error instanceof Error ? error.message : "unknown",
      });
      await delay(context.pollMilliseconds);
    } finally {
      if (registered) context.onSettled();
    }
  }
}

export async function claimNextProcessingJob(
  pool: Pool,
  projectKind: ProjectKind,
  workerId: string,
  leaseMilliseconds: number,
): Promise<ProcessingJob | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const exhausted = await client.query<{
      id: string;
      project_id: string;
      source_version_id: string;
      options: ProcessingJob["options"];
    }>(
      `UPDATE processing_jobs
       SET status = 'failed',
           error_code = 'WORKER_LEASE_EXHAUSTED',
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = now()
       WHERE project_kind = $1
         AND status IN ('processing', 'verifying')
         AND lease_expires_at <= now()
         AND attempt >= max_attempts
       RETURNING id, project_id, source_version_id, options`,
      [projectKind],
    );
    for (const row of exhausted.rows) {
      await updateProjectStatusForJob(client, {
        projectId: row.project_id,
        sourceVersionId: row.source_version_id,
        jobType: "processing",
        jobId: row.id,
        status: row.options.pdfRegionOcr ? "needs_review" : "failed",
        finished: true,
      });
    }

    const result = await client.query<ProcessingRow>(
      `WITH candidate AS (
         SELECT id
         FROM processing_jobs
         WHERE project_kind = $1
           AND attempt < max_attempts
           AND (
             (status = 'queued' AND next_attempt_at <= now())
             OR (
               status IN ('processing', 'verifying')
               AND lease_expires_at <= now()
             )
           )
         ORDER BY next_attempt_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE processing_jobs AS job
       SET status = 'processing',
           progress = 25,
           attempt = job.attempt + 1,
           lease_owner = $2,
           lease_expires_at = now() + ($3 * interval '1 millisecond'),
           error_code = NULL,
           updated_at = now()
       FROM candidate
       WHERE job.id = candidate.id
       RETURNING
         job.id, job.project_id, job.source_version_id, job.project_kind,
         job.options, job.status, job.progress, job.attempt, job.max_attempts,
         job.next_attempt_at, job.lease_owner, job.lease_expires_at,
         job.error_code, job.created_at, job.updated_at`,
      [projectKind, workerId, leaseMilliseconds],
    );
    if (result.rows[0]) {
      await updateProjectStatusForJob(client, {
        projectId: result.rows[0].project_id,
        sourceVersionId: result.rows[0].source_version_id,
        jobType: "processing",
        jobId: result.rows[0].id,
        status: "processing",
        finished: false,
      });
    }
    await client.query("COMMIT");
    return result.rows[0] ? mapProcessingRow(result.rows[0]) : null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function processClaimedJob(
  context: WorkerLoopContext,
  job: ProcessingJob,
): Promise<void> {
  const startedAt = Date.now();
  const storedRasterAssetKeys: string[] = [];
  let documentPersisted = false;
  const heartbeat = startLeaseHeartbeat(
    () => renewLease(
      context.pool,
      job.id,
      context.workerId,
      context.leaseMilliseconds,
    ),
    context.leaseMilliseconds,
  );

  try {
    const upload = await context.pool.query<{
      object_key: string;
      content_type: string;
      expected_size_bytes: number;
      sha256: string | null;
    }>(
      `SELECT object_key, content_type, expected_size_bytes, sha256
       FROM upload_sessions
       WHERE project_id = $1 AND source_version_id = $2 AND status = 'ready'
       ORDER BY created_at DESC
       LIMIT 1`,
      [job.projectId, job.sourceVersionId],
    );
    const readyUpload = upload.rows[0];
    if (!readyUpload) throw new WorkerError("SOURCE_NOT_READY");

    let response;
    try {
      response = await context.storage.get(readyUpload.object_key, {
        maxBytes: readyUpload.expected_size_bytes,
      });
    } catch (error) {
      if (isObjectStorageIntegrityFailure(error)) {
        throw new WorkerError("SOURCE_INTEGRITY_FAILED");
      }
      throw error;
    }
    if (!response) throw new WorkerError("SOURCE_NOT_READY");
    if (
      !readyUpload.sha256 ||
      !hasExpectedObjectIntegrity(response, {
        contentType: readyUpload.content_type,
        sizeBytes: readyUpload.expected_size_bytes,
        sha256: readyUpload.sha256,
      })
    ) {
      throw new WorkerError("SOURCE_INTEGRITY_FAILED");
    }
    const source = response.body;

    const parsedOptions = jobOptionsSchema.parse(job.options);
    let sourceDocument: LayerDocument;
    let regionalExpectedRevision: number | undefined;
    if (job.projectKind === "image") {
      const prepared = await prepareImageSource({
        projectId: job.projectId,
        sourceVersionId: job.sourceVersionId,
        source,
      });
      for (const asset of prepared.rasterAssets) {
        if (heartbeat.leaseLost()) throw new ProcessingLeaseLostError();
        await context.storage.put({
          key: asset.objectKey,
          body: asset.body,
          contentType: asset.contentType,
          sizeBytes: asset.sizeBytes,
        });
        storedRasterAssetKeys.push(asset.objectKey);
      }
      sourceDocument = prepared.document;
    } else if (parsedOptions.pdfRegionOcr) {
      if (!context.pdfOcrEngine) {
        throw new WorkerError("OCR_FAILED");
      }
      const current = await context.pool.query<{ document: LayerDocument }>(
        `SELECT document
         FROM layer_documents
         WHERE project_id = $1 AND source_version_id = $2`,
        [job.projectId, job.sourceVersionId],
      );
      const currentDocument = current.rows[0]?.document;
      if (!currentDocument) {
        throw new WorkerError("INVALID_DOCUMENT_OPERATION");
      }
      const result = await applyPdfRegionOcr({
        source,
        document: currentDocument,
        operation: parsedOptions.pdfRegionOcr,
        ocrEngine: context.pdfOcrEngine,
      });
      sourceDocument = result.document;
      regionalExpectedRevision = parsedOptions.pdfRegionOcr.baseRevision;
    } else {
      sourceDocument = await preparePdfSource({
        projectId: job.projectId,
        sourceVersionId: job.sourceVersionId,
        source,
        separationMode: parsedOptions.pdfSeparationMode,
        ...(context.pdfOcrEngine
          ? { ocrEngine: context.pdfOcrEngine }
          : {}),
      });
    }
    if (heartbeat.leaseLost()) throw new ProcessingLeaseLostError();
    const client = await context.pool.connect();
    try {
      await client.query("BEGIN");
      await assertAndMarkVerifying(client, job.id, context.workerId);
      const previous = await client.query<{
        revision: number;
        document: LayerDocument;
      }>(
        `SELECT revision, document
         FROM layer_documents
         WHERE project_id = $1 AND source_version_id = $2
         FOR UPDATE`,
        [job.projectId, job.sourceVersionId],
      );
      const previousDocument = previous.rows[0];
      if (
        regionalExpectedRevision !== undefined &&
        (!previousDocument ||
          previousDocument.revision !== regionalExpectedRevision)
      ) {
        throw new WorkerError("DOCUMENT_REVISION_CONFLICT");
      }
      const document =
        regionalExpectedRevision === undefined
          ? {
              ...sourceDocument,
              revision: (previousDocument?.revision ?? 0) + 1,
            }
          : sourceDocument;
      if (previousDocument) {
        await client.query(
          `INSERT INTO layer_document_revisions (
             project_id, source_version_id, revision, document, created_at
           ) VALUES ($1, $2, $3, $4::jsonb, now())
           ON CONFLICT (project_id, source_version_id, revision) DO NOTHING`,
          [
            job.projectId,
            job.sourceVersionId,
            previousDocument.revision,
            JSON.stringify(previousDocument.document),
          ],
        );
      }
      await client.query(
        `INSERT INTO layer_documents (
           project_id, source_version_id, revision, document, created_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4::jsonb, $5, $5)
         ON CONFLICT (project_id, source_version_id) DO UPDATE SET
           revision = EXCLUDED.revision,
           document = EXCLUDED.document,
           updated_at = EXCLUDED.updated_at`,
        [
          document.projectId,
          document.sourceVersionId,
          document.revision ?? 1,
          JSON.stringify(document),
          document.generatedAt,
        ],
      );
      await client.query(
        `INSERT INTO layer_document_revisions (
           project_id, source_version_id, revision, document, created_at
         ) VALUES ($1, $2, $3, $4::jsonb, now())
         ON CONFLICT (project_id, source_version_id, revision) DO NOTHING`,
        [
          job.projectId,
          job.sourceVersionId,
          document.revision,
          JSON.stringify(document),
        ],
      );
      await client.query(
        `DELETE FROM layer_document_revisions
         WHERE project_id = $1
           AND source_version_id = $2
           AND revision < $3
           AND NOT (revision = ANY($4::integer[]))`,
        [
          job.projectId,
          job.sourceVersionId,
          Math.max(1, (document.revision ?? 1) - 100),
          document.editTimeline?.entries.map((entry) => entry.revision) ?? [],
        ],
      );
      const completed = await client.query(
        `UPDATE processing_jobs
         SET status = 'ready',
             progress = 100,
             error_code = NULL,
             lease_owner = NULL,
             lease_expires_at = NULL,
             updated_at = now()
         WHERE id = $1
           AND lease_owner = $2
           AND lease_expires_at > now()`,
        [job.id, context.workerId],
      );
      if (completed.rowCount !== 1) throw new ProcessingLeaseLostError();
      await updateProjectStatusForJob(client, {
        projectId: job.projectId,
        sourceVersionId: job.sourceVersionId,
        jobType: "processing",
        jobId: job.id,
        status: "needs_review",
        finished: true,
      });
      await client.query("COMMIT");
      documentPersisted = true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await recordWorkerEvent(context.pool, {
      workerType: context.projectKind === "image" ? "media" : "document",
      eventType: "completed",
      jobId: job.id,
      durationMs: Date.now() - startedAt,
    }).catch((eventError: unknown) => {
      log(context.serviceName, "error", "worker.event_record_failed", {
        job_id: job.id,
        error:
          eventError instanceof Error ? eventError.message : "unknown",
      });
    });
  } catch (error) {
    const isLeaseLoss =
      error instanceof ProcessingLeaseLostError || heartbeat.leaseLost();
    if (
      !isLeaseLoss &&
      !documentPersisted &&
      storedRasterAssetKeys.length > 0
    ) {
      await Promise.allSettled(
        storedRasterAssetKeys.map((key) =>
          context.storage.delete(key),
        ),
      );
    }
    if (isLeaseLoss) {
      await recordWorkerEvent(context.pool, {
        workerType: context.projectKind === "image" ? "media" : "document",
        eventType: "lease_lost",
        jobId: job.id,
      }).catch(() => undefined);
      log(context.serviceName, "warning", "processing.lease_lost", {
        job_id: job.id,
        project_id: job.projectId,
        worker_id: context.workerId,
      });
      return;
    }
    const errorCode = toErrorCode(error);
    const result = await retryOrFail(
      context.pool,
      job,
      context.workerId,
      errorCode,
    );
    await recordWorkerEvent(context.pool, {
      workerType: context.projectKind === "image" ? "media" : "document",
      eventType:
        result === "queued"
          ? "retry"
          : result === "lease_lost"
            ? "lease_lost"
            : "failed",
      jobId: job.id,
      durationMs: Date.now() - startedAt,
    }).catch(() => undefined);
    log(
      context.serviceName,
      result === "queued" ? "warning" : "error",
      result === "queued" ? "processing.retry_scheduled" : "processing.failed",
      {
        job_id: job.id,
        project_id: job.projectId,
        attempt: job.attempt,
        max_attempts: job.maxAttempts,
        error_code: errorCode,
      },
    );
  } finally {
    heartbeat.stop();
    await context.usageMeter
      .recordProcessingSeconds(
        job.id,
        job.attempt,
        Math.max(1, Math.ceil((Date.now() - startedAt) / 1_000)),
      )
      .catch((error: unknown) => {
        log(context.serviceName, "error", "usage.record_failed", {
          job_id: job.id,
          attempt: job.attempt,
          error: error instanceof Error ? error.message : "unknown",
        });
      });
  }
}

async function renewLease(
  pool: Pool,
  jobId: string,
  workerId: string,
  leaseMilliseconds: number,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE processing_jobs
     SET lease_expires_at = now() + ($3 * interval '1 millisecond'),
         updated_at = now()
     WHERE id = $1
       AND lease_owner = $2
       AND status IN ('processing', 'verifying')
       AND lease_expires_at > now()`,
    [jobId, workerId, leaseMilliseconds],
  );
  return result.rowCount === 1;
}

async function assertAndMarkVerifying(
  client: PoolClient,
  jobId: string,
  workerId: string,
): Promise<void> {
  const result = await client.query(
    `UPDATE processing_jobs
     SET status = 'verifying', progress = 85, updated_at = now()
     WHERE id = $1
       AND lease_owner = $2
       AND status = 'processing'
       AND lease_expires_at > now()`,
    [jobId, workerId],
  );
  if (result.rowCount !== 1) throw new ProcessingLeaseLostError();
}

async function retryOrFail(
  pool: Pool,
  job: ProcessingJob,
  workerId: string,
  errorCode: string,
): Promise<"queued" | "failed" | "lease_lost"> {
  const policy = getProcessingRetryPolicy(job.attempt, job.maxAttempts);
  const retry =
    policy.retry &&
    ![
      "DOCUMENT_REVISION_CONFLICT",
      "INVALID_DOCUMENT_OPERATION",
      "INVALID_PROCESSING_OPTIONS",
    ].includes(errorCode);
  const result = await pool.query<{ status: "queued" | "failed" }>(
    `UPDATE processing_jobs
     SET status = CASE WHEN $5 THEN 'queued' ELSE 'failed' END,
         progress = CASE WHEN $5 THEN 0 ELSE progress END,
         next_attempt_at =
           CASE
             WHEN $5
             THEN now() + ($4 * interval '1 millisecond')
             ELSE next_attempt_at
           END,
         lease_owner = NULL,
         lease_expires_at = NULL,
         error_code = $3,
         updated_at = now()
     WHERE id = $1
       AND lease_owner = $2
       AND status IN ('processing', 'verifying')
     RETURNING status`,
    [
      job.id,
      workerId,
      errorCode,
      policy.delayMilliseconds,
      retry,
    ],
  );
  const status = result.rows[0]?.status;
  if (!status) return "lease_lost";
  if (status === "failed") {
    await updateProjectStatusForJob(pool, {
      projectId: job.projectId,
      sourceVersionId: job.sourceVersionId,
      jobType: "processing",
      jobId: job.id,
      status: job.options.pdfRegionOcr ? "needs_review" : "failed",
      finished: true,
    });
  }
  return status;
}

function toErrorCode(error: unknown): string {
  if (error instanceof DocumentProcessingError) return error.code;
  if (error instanceof PdfRegionOcrError) return error.code;
  if (error instanceof MediaProcessingError) return error.code;
  if (error instanceof WorkerError) return error.code;
  if (error instanceof z.ZodError) return "INVALID_PROCESSING_OPTIONS";
  return "WORKER_FAILED";
}

class WorkerError extends Error {
  constructor(
    readonly code:
      | "SOURCE_NOT_READY"
      | "SOURCE_INTEGRITY_FAILED"
      | "OCR_FAILED"
      | "INVALID_DOCUMENT_OPERATION"
      | "DOCUMENT_REVISION_CONFLICT",
  ) {
    super(code);
  }
}

class ProcessingLeaseLostError extends Error {
  constructor() {
    super("Processing job lease was lost.");
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function log(
  service: ProcessingWorkerOptions["serviceName"],
  level: "info" | "warning" | "error",
  message: string,
  context: Record<string, unknown>,
): void {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service,
      message,
      context,
    })}\n`,
  );
}
