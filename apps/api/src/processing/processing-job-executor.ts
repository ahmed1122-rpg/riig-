import type {
  LayerDocument,
  ProcessingJob,
  ProjectKind,
} from "@motionprep/contracts";
import {
  LocalArabicPdfOcrEngine,
  preparePdfSource,
} from "@motionprep/document-processing";
import { prepareImageSource } from "@motionprep/media-processing";
import type { Pool, PoolClient } from "pg";
import { hasExpectedObjectIntegrity } from "../storage/object-integrity.js";
import { isObjectStorageIntegrityFailure } from "../storage/object-storage.js";
import { S3ObjectStorage } from "../storage/s3-object-storage.js";
import { PostgresUsageMeter } from "../infrastructure/postgres/postgres-usage-meter.js";
import { startLeaseHeartbeat } from "../jobs/lease-heartbeat.js";
import { recordWorkerEvent } from "../observability/worker-events.js";
import { updateProjectStatusForJob } from "../projects/project-job-status.js";
import { getProcessingRetryPolicy } from "./processing-worker-policy.js";
import {
  applyPdfRegionOcr,
} from "./pdf-region-ocr.js";
import {
  ProcessingLeaseLostError,
  ProcessingWorkerError,
  processingErrorCode,
} from "./processing-worker-errors.js";
import { cleanupRasterAssets } from "./raster-asset-cleanup.js";
import { writeProcessingRasterAssets } from "./processing-raster-asset-writes.js";
import { processingJobOptionsSchema } from "./processing-job-options.js";

export interface ProcessingJobExecutionContext {
  pool: Pool;
  storage: S3ObjectStorage;
  projectKind: ProjectKind;
  workerId: string;
  leaseMilliseconds: number;
  rasterAssetWriteConcurrency: number;
  pdfOcrEngine: LocalArabicPdfOcrEngine | null;
  usageMeter: PostgresUsageMeter;
  log: (
    level: "info" | "warning" | "error",
    message: string,
    context: Record<string, unknown>,
  ) => void;
}

export async function processClaimedJob(
  context: ProcessingJobExecutionContext,
  job: ProcessingJob,
): Promise<void> {
  const startedAt = Date.now();
  const storedRasterAssetKeys: string[] = [];
  let documentPersisted = false;
  const heartbeat = startLeaseHeartbeat(
    () =>
      renewLease(
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
    if (!readyUpload) throw new ProcessingWorkerError("SOURCE_NOT_READY");

    let response;
    try {
      response = await context.storage.get(readyUpload.object_key, {
        maxBytes: readyUpload.expected_size_bytes,
      });
    } catch (error) {
      if (isObjectStorageIntegrityFailure(error)) {
        throw new ProcessingWorkerError("SOURCE_INTEGRITY_FAILED");
      }
      throw error;
    }
    if (!response) throw new ProcessingWorkerError("SOURCE_NOT_READY");
    if (
      !readyUpload.sha256 ||
      !hasExpectedObjectIntegrity(response, {
        contentType: readyUpload.content_type,
        sizeBytes: readyUpload.expected_size_bytes,
        sha256: readyUpload.sha256,
      })
    ) {
      throw new ProcessingWorkerError("SOURCE_INTEGRITY_FAILED");
    }
    const source = response.body;

    const parsedOptions = processingJobOptionsSchema.parse(job.options);
    let sourceDocument: LayerDocument;
    let regionalExpectedRevision: number | undefined;
    if (job.projectKind === "image") {
      const prepared = await prepareImageSource({
        projectId: job.projectId,
        sourceVersionId: job.sourceVersionId,
        source,
      });
      storedRasterAssetKeys.push(
        ...(await writeProcessingRasterAssets(
          context,
          job.id,
          prepared.rasterAssets,
          () => {
            if (heartbeat.leaseLost()) throw new ProcessingLeaseLostError();
          },
        )),
      );
      sourceDocument = prepared.document;
    } else if (parsedOptions.pdfRegionOcr) {
      if (!context.pdfOcrEngine) throw new ProcessingWorkerError("OCR_FAILED");
      const current = await context.pool.query<{ document: LayerDocument }>(
        `SELECT document
         FROM layer_documents
         WHERE project_id = $1 AND source_version_id = $2`,
        [job.projectId, job.sourceVersionId],
      );
      const currentDocument = current.rows[0]?.document;
      if (!currentDocument) {
        throw new ProcessingWorkerError("INVALID_DOCUMENT_OPERATION");
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
        throw new ProcessingWorkerError("DOCUMENT_REVISION_CONFLICT");
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
        `DELETE FROM layer_document_revisions AS stored_revision
         WHERE stored_revision.project_id = $1
           AND stored_revision.source_version_id = $2
           AND stored_revision.revision < $3
           AND NOT (stored_revision.revision = ANY($4::integer[]))
           AND NOT EXISTS (
             SELECT 1
             FROM export_jobs AS export_job
             WHERE export_job.project_id = stored_revision.project_id
               AND export_job.source_version_id = stored_revision.source_version_id
               AND export_job.document_revision = stored_revision.revision
           )`,
        [
          job.projectId,
          job.sourceVersionId,
          Math.max(1, (document.revision ?? 1) - 100),
          [
            ...(document.editTimeline?.entries.map(
              (entry) => entry.revision,
            ) ?? []),
            ...(document.editTimeline?.navigationEntries?.map(
              (entry) => entry.resultRevision,
            ) ?? []),
          ],
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
      context.log("error", "worker.event_record_failed", {
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
      await cleanupRasterAssets(
        context.storage,
        storedRasterAssetKeys,
        (cleanupError, objectKey) => {
          context.log("error", "processing.asset_cleanup_failed", {
            job_id: job.id,
            object_key: objectKey,
            error:
              cleanupError instanceof Error
                ? cleanupError.message
                : "unknown",
          });
        },
      );
    }
    if (isLeaseLoss) {
      await recordWorkerEvent(context.pool, {
        workerType: context.projectKind === "image" ? "media" : "document",
        eventType: "lease_lost",
        jobId: job.id,
      }).catch((eventError: unknown) => {
        context.log("error", "worker.event_record_failed", {
          job_id: job.id,
          event_type: "lease_lost",
          error:
            eventError instanceof Error ? eventError.message : "unknown",
        });
      });
      context.log("warning", "processing.lease_lost", {
        job_id: job.id,
        correlation_id: job.correlationId,
        project_id: job.projectId,
        worker_id: context.workerId,
      });
      return;
    }
    const errorCode = processingErrorCode(error);
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
    }).catch((eventError: unknown) => {
      context.log("error", "worker.event_record_failed", {
        job_id: job.id,
        event_type:
          result === "queued"
            ? "retry"
            : result === "lease_lost"
              ? "lease_lost"
              : "failed",
        error:
          eventError instanceof Error ? eventError.message : "unknown",
      });
    });
    context.log(
      result === "queued" ? "warning" : "error",
      result === "queued"
        ? "processing.retry_scheduled"
        : "processing.failed",
      {
        job_id: job.id,
        correlation_id: job.correlationId,
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
        context.log("error", "usage.record_failed", {
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
