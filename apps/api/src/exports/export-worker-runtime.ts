import os from "node:os";
import type { ExportJob } from "@motionprep/contracts";
import sharp from "sharp";
import { InMemoryIdempotencyStore } from "../idempotency/idempotency-store.js";
import { createDatabase } from "../infrastructure/postgres/database.js";
import { PostgresExportRepository } from "../infrastructure/postgres/postgres-export-repository.js";
import { PostgresLayerDocumentRepository } from "../infrastructure/postgres/postgres-processing-repository.js";
import { PostgresUploadRepository } from "../infrastructure/postgres/postgres-upload-repository.js";
import {
  S3ObjectStorage,
  type S3ObjectStorageOptions,
} from "../storage/s3-object-storage.js";
import { ExportService } from "./export-service.js";
import { startWorkerHeartbeat } from "../observability/worker-heartbeat.js";
import { recordWorkerEvent } from "../observability/worker-events.js";
import { updateProjectStatusForJob } from "../projects/project-job-status.js";
import { WorkerDrainCoordinator } from "../jobs/worker-drain.js";
import { releaseExportJobForShutdown } from "../jobs/worker-shutdown-requeue.js";
import {
  initialPollingDelay,
  jitteredPollingDelay,
} from "../jobs/polling-delay.js";
import { abortableDelay } from "../jobs/abortable-delay.js";
import { withJobTrace } from "../observability/tracing.js";

export interface ExportWorkerConfig {
  databaseUrl: string;
  databasePoolMax: number;
  objectStorage: S3ObjectStorageOptions;
  pollMilliseconds: number;
  concurrency: number;
  leaseMilliseconds: number;
  drainTimeoutMilliseconds: number;
  sharpCacheMemoryMb: number;
  sharpConcurrency: number;
  workerId?: string;
}

export interface ExportWorkerLog {
  level: "info" | "error";
  message: string;
  context: Record<string, unknown>;
}

export async function runExportWorker(
  config: ExportWorkerConfig,
  options: {
    signal?: AbortSignal;
    onLog?: (entry: ExportWorkerLog) => void;
  } = {},
): Promise<void> {
  const log = (
    level: ExportWorkerLog["level"],
    message: string,
    context: Record<string, unknown>,
  ) => options.onLog?.({ level, message, context });
  const database = createDatabase(
    config.databaseUrl,
    config.databasePoolMax,
    {
      applicationName: "motionprep-worker-export",
      onError: (error) => {
        const errorCode =
          "code" in error && typeof error.code === "string"
            ? error.code
            : "DATABASE_POOL_ERROR";
        log("error", "database.pool_error", {
          error_code: errorCode,
          error_name: error.name,
        });
      },
    },
  );
  const storage = new S3ObjectStorage(config.objectStorage);
  const repository = new PostgresExportRepository(database.pool);
  const service = new ExportService(
    repository,
    () => new Date(),
    new InMemoryIdempotencyStore(),
    new PostgresUploadRepository(database.pool),
    storage,
    new PostgresLayerDocumentRepository(database.pool),
    false,
    (error, objectKey) => {
      log("error", "export.artifact_cleanup_failed", {
        object_key: objectKey,
        error: error instanceof Error ? error.message : "unknown",
      });
    },
  );
  const workerId =
    config.workerId ??
    `${os.hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
  const drain = new WorkerDrainCoordinator<{
    job: ExportJob;
    workerId: string;
  }>({
    timeoutMilliseconds: config.drainTimeoutMilliseconds,
    release: async ({ job, workerId: leaseOwner }) => {
      const released = await releaseExportJobForShutdown(
        database.pool,
        job,
        leaseOwner,
      );
      if (!released) return;
      await recordWorkerEvent(database.pool, {
        workerType: "export",
        eventType: "retry",
        jobId: job.id,
      });
      log("info", "export.shutdown_requeued", {
        job_id: job.id,
        worker_id: leaseOwner,
      });
    },
    onReleaseError: (error, { job, workerId: leaseOwner }) => {
      log("error", "export.shutdown_requeue_failed", {
        job_id: job.id,
        worker_id: leaseOwner,
        error: error instanceof Error ? error.message : "unknown",
      });
    },
  });
  sharp.cache({
    memory: config.sharpCacheMemoryMb,
    files: 0,
    items: Math.max(16, config.concurrency * 8),
  });
  sharp.concurrency(config.sharpConcurrency);
  const requestDrain = () => {
    log("info", "worker.drain_started", {
      active_jobs: drain.activeCount,
      drain_timeout_ms: config.drainTimeoutMilliseconds,
    });
    drain.requestShutdown();
  };
  options.signal?.addEventListener("abort", requestDrain, { once: true });
  if (options.signal?.aborted) requestDrain();

  await Promise.all([database.ready(), storage.ready(false)]);
  log("info", "worker.ready", {
    worker_id: workerId,
    concurrency: config.concurrency,
    lease_ms: config.leaseMilliseconds,
    sharp_cache_memory_mb: config.sharpCacheMemoryMb,
    sharp_concurrency: config.sharpConcurrency,
  });
  const heartbeat = await startWorkerHeartbeat(database.pool, {
    instanceId: workerId,
    workerType: "export",
    releaseVersion: process.env.RELEASE_VERSION ?? "development",
    concurrency: config.concurrency,
    onError: (error) => {
      log("error", "worker.heartbeat_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    },
  });

  try {
    await Promise.all(
      Array.from({ length: config.concurrency }, (_, index) =>
        workerLoop(index + 1),
      ),
    );
  } finally {
    options.signal?.removeEventListener("abort", requestDrain);
    if (options.signal?.aborted) await drain.waitForRelease();
    await heartbeat.stop();
    await database.close();
    storage.destroy();
  }

  async function workerLoop(slot: number): Promise<void> {
    const slotWorkerId = `${workerId}:${slot}`;
    await abortableDelay(
      initialPollingDelay(config.pollMilliseconds),
      options.signal,
    );
    while (!options.signal?.aborted) {
      try {
        const startedAt = Date.now();
        const job = await service.claimAndProcess(
          slotWorkerId,
          config.leaseMilliseconds,
          {
            onClaimed: (claimed) =>
              drain.register(slotWorkerId, {
                job: claimed,
                workerId: slotWorkerId,
              }),
            onSettled: () => drain.unregister(slotWorkerId),
            runClaimed: (claimed, run) =>
              withJobTrace("motionprep.export.execute", claimed, run),
          },
        );
        if (!job) {
          await abortableDelay(
            jitteredPollingDelay(config.pollMilliseconds),
            options.signal,
          );
          continue;
        }
        await recordWorkerEvent(database.pool, {
          workerType: "export",
          eventType:
            job.errorCode === "LEASE_LOST"
              ? "lease_lost"
              : job.status === "ready"
                ? "completed"
                : job.status === "failed"
                  ? "failed"
                  : "retry",
          jobId: job.id,
          durationMs: Date.now() - startedAt,
        }).catch((eventError: unknown) => {
          log("error", "worker.event_record_failed", {
            slot,
            job_id: job.id,
            error:
              eventError instanceof Error
                ? eventError.message
                : "unknown",
          });
        });
        if (job.status === "ready") {
          await updateProjectStatusForJob(database.pool, {
            projectId: job.projectId,
            sourceVersionId: job.sourceVersionId,
            jobType: "export",
            jobId: job.id,
            status: "completed",
            finished: true,
            ...(job.documentRevision === undefined
              ? {}
              : { documentRevision: job.documentRevision }),
          });
        } else if (job.status === "failed") {
          await updateProjectStatusForJob(database.pool, {
            projectId: job.projectId,
            sourceVersionId: job.sourceVersionId,
            jobType: "export",
            jobId: job.id,
            status: "failed",
            finished: true,
            ...(job.documentRevision === undefined
              ? {}
              : { documentRevision: job.documentRevision }),
          });
        }
        log("info", "export.cycle_completed", {
          slot,
          job_id: job.id,
          correlation_id: job.correlationId,
          project_id: job.projectId,
          status: job.status,
          attempt: job.attempt,
          error_code: job.errorCode,
        });
      } catch (error) {
        log("error", "worker.loop_failed", {
          slot,
          error: error instanceof Error ? error.message : "unknown",
        });
        await abortableDelay(
          jitteredPollingDelay(config.pollMilliseconds),
          options.signal,
        );
      }
    }
  }
}
