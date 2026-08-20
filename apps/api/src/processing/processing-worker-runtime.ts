import type { ProcessingJob, ProjectKind } from "@motionprep/contracts";
import { LocalArabicPdfOcrEngine } from "@motionprep/document-processing";
import { hostname } from "node:os";
import sharp from "sharp";
import { createDatabase } from "../infrastructure/postgres/database.js";
import { createS3ObjectStorageOptions } from "../storage/object-storage-environment.js";
import { S3ObjectStorage } from "../storage/s3-object-storage.js";
import { LeaseGuardedObjectStorage } from "../storage/leased-object-storage.js";
import { PostgresObjectWriteLeaseCoordinator } from "../infrastructure/postgres/postgres-object-write-lease.js";
import { loadProcessingWorkerConfig } from "./processing-worker-config.js";
import { PostgresUsageMeter } from "../infrastructure/postgres/postgres-usage-meter.js";
import { claimNextProcessingJob } from "../infrastructure/postgres/postgres-processing-job-claim.js";
import { PostgresDerivedAssetRegistry } from "../infrastructure/postgres/postgres-derived-asset-registry.js";
import { WorkerDrainCoordinator } from "../jobs/worker-drain.js";
import { releaseProcessingJobForShutdown } from "../jobs/worker-shutdown-requeue.js";
import {
  initialPollingDelay,
  jitteredPollingDelay,
} from "../jobs/polling-delay.js";
import { startWorkerHeartbeat } from "../observability/worker-heartbeat.js";
import { recordWorkerEvent } from "../observability/worker-events.js";
import { withJobTrace } from "../observability/tracing.js";
import {
  processClaimedJob,
  type ProcessingJobExecutionContext,
} from "./processing-job-executor.js";

export { claimNextProcessingJob } from "../infrastructure/postgres/postgres-processing-job-claim.js";

export interface ProcessingWorkerOptions {
  projectKind: ProjectKind;
  serviceName: "motionprep-worker-media" | "motionprep-worker-document";
}

export async function runProcessingWorker(
  options: ProcessingWorkerOptions,
): Promise<void> {
  const config = loadProcessingWorkerConfig(process.env);
  const database = createDatabase(
    config.DATABASE_URL,
    config.DATABASE_POOL_MAX,
    {
      applicationName: options.serviceName,
      onError: (error) => {
        const errorCode =
          "code" in error && typeof error.code === "string"
            ? error.code
            : "DATABASE_POOL_ERROR";
        log(options.serviceName, "error", "database.pool_error", {
          error_code: errorCode,
          error_name: error.name,
        });
      },
    },
  );
  const pool = database.pool;
  const rawStorage = new S3ObjectStorage(createS3ObjectStorageOptions(config));
  const storage = new LeaseGuardedObjectStorage(
    rawStorage,
    new PostgresObjectWriteLeaseCoordinator(pool),
  );
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
  const derivedAssets = new PostgresDerivedAssetRegistry(pool);
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
      rawStorage.ready(false),
    ]);
    log(options.serviceName, "info", "worker.ready", {
      concurrency,
      lease_ms: config.PROCESSING_LEASE_MS,
      project_kind: options.projectKind,
      sharp_cache_memory_mb: config.SHARP_CACHE_MEMORY_MB,
      sharp_concurrency: config.SHARP_CONCURRENCY,
      raster_asset_write_concurrency:
        config.RASTER_ASSET_WRITE_CONCURRENCY,
    });
    const heartbeat = await startWorkerHeartbeat(pool, {
      instanceId,
      workerType: options.projectKind === "image" ? "media" : "document",
      releaseVersion: process.env.RELEASE_VERSION ?? "development",
      concurrency,
      ...(process.env.WORKER_HEALTH_INSTANCE_FILE
        ? { healthInstanceFile: process.env.WORKER_HEALTH_INSTANCE_FILE }
        : {}),
      onError: (error) => {
        log(options.serviceName, "error", "worker.heartbeat_failed", {
          error: error instanceof Error ? error.message : "unknown",
        });
      },
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
            rasterAssetWriteConcurrency:
              config.RASTER_ASSET_WRITE_CONCURRENCY,
            pollMilliseconds: config.PROCESSING_POLL_MS,
            pdfOcrEngine,
            usageMeter,
            derivedAssets,
            log: (level, message, context) =>
              log(options.serviceName, level, message, context),
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
    await database.close();
    await pdfOcrEngine?.close();
    rawStorage.destroy();
  }
}

interface WorkerLoopContext extends ProcessingJobExecutionContext {
  serviceName: ProcessingWorkerOptions["serviceName"];
  pollMilliseconds: number;
  isRunning: () => boolean;
  onClaimed: (job: ProcessingJob) => Promise<boolean>;
  onSettled: () => void;
}

async function workerLoop(context: WorkerLoopContext): Promise<void> {
  await delay(initialPollingDelay(context.pollMilliseconds));
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
        await delay(jitteredPollingDelay(context.pollMilliseconds));
        continue;
      }
      registered = await context.onClaimed(job);
      if (!registered) continue;
      log(context.serviceName, "info", "processing.started", {
        job_id: job.id,
        correlation_id: job.correlationId,
        project_id: job.projectId,
        attempt: job.attempt,
        max_attempts: job.maxAttempts,
      });
      await withJobTrace("motionprep.processing.execute", job, () =>
        processClaimedJob(context, job),
      );
      log(context.serviceName, "info", "processing.completed", {
        job_id: job.id,
        correlation_id: job.correlationId,
        project_id: job.projectId,
        attempt: job.attempt,
      });
    } catch (error) {
      log(context.serviceName, "error", "worker.loop_failed", {
        worker_id: context.workerId,
        error: error instanceof Error ? error.message : "unknown",
      });
      await delay(jitteredPollingDelay(context.pollMilliseconds));
    } finally {
      if (registered) context.onSettled();
    }
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
