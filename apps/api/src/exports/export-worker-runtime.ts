import os from "node:os";
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

export interface ExportWorkerConfig {
  databaseUrl: string;
  databasePoolMax: number;
  objectStorage: S3ObjectStorageOptions;
  pollMilliseconds: number;
  concurrency: number;
  leaseMilliseconds: number;
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
  const database = createDatabase(config.databaseUrl, config.databasePoolMax);
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
  );
  const workerId =
    config.workerId ??
    `${os.hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
  sharp.cache({
    memory: config.sharpCacheMemoryMb,
    files: 0,
    items: Math.max(16, config.concurrency * 8),
  });
  sharp.concurrency(config.sharpConcurrency);
  const log = (
    level: ExportWorkerLog["level"],
    message: string,
    context: Record<string, unknown>,
  ) => options.onLog?.({ level, message, context });

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
  });

  try {
    await Promise.all(
      Array.from({ length: config.concurrency }, (_, index) =>
        workerLoop(index + 1),
      ),
    );
  } finally {
    await heartbeat.stop();
    await database.close();
    storage.destroy();
  }

  async function workerLoop(slot: number): Promise<void> {
    while (!options.signal?.aborted) {
      try {
        const startedAt = Date.now();
        const job = await service.claimAndProcess(
          `${workerId}:${slot}`,
          config.leaseMilliseconds,
        );
        if (!job) {
          await abortableDelay(config.pollMilliseconds, options.signal);
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
          await database.pool.query(
            `
              UPDATE projects
              SET status = 'completed', updated_at = now()
              WHERE id = $1
            `,
            [job.projectId],
          );
        } else if (job.status === "failed") {
          await database.pool.query(
            `
              UPDATE projects
              SET status = 'failed', updated_at = now()
              WHERE id = $1
            `,
            [job.projectId],
          );
        }
        log("info", "export.cycle_completed", {
          slot,
          job_id: job.id,
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
        await abortableDelay(config.pollMilliseconds, options.signal);
      }
    }
  }
}

function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    timeout.unref();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
