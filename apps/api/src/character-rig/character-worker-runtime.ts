import { hostname } from "node:os";
import type { S3ObjectStorageOptions } from "../storage/s3-object-storage.js";
import { S3ObjectStorage } from "../storage/s3-object-storage.js";
import { createDatabase } from "../infrastructure/postgres/database.js";
import { PostgresCharacterJobRepository } from "../infrastructure/postgres/postgres-character-job-repository.js";
import { PostgresCharacterRigRepository } from "../infrastructure/postgres/postgres-character-rig-repository.js";
import { PostgresCharacterJobResultCommitter } from "../infrastructure/postgres/postgres-character-job-result-committer.js";
import { startWorkerHeartbeat } from "../observability/worker-heartbeat.js";
import { recordWorkerEvent } from "../observability/worker-events.js";
import { WorkerDrainCoordinator } from "../jobs/worker-drain.js";
import { HttpCharacterInferenceProvider } from "./http-character-inference-provider.js";
import { runCharacterWorkerLoop } from "./character-worker-loop.js";
import { LeaseGuardedObjectStorage } from "../storage/leased-object-storage.js";
import { PostgresObjectWriteLeaseCoordinator } from "../infrastructure/postgres/postgres-object-write-lease.js";

export interface CharacterWorkerConfig {
  databaseUrl: string;
  databasePoolMax: number;
  objectStorage: S3ObjectStorageOptions;
  inferenceBaseUrl: string;
  inferenceApiKey: string;
  inferenceTimeoutMilliseconds: number;
  allowInsecureLocalhost: boolean;
  pollMilliseconds: number;
  concurrency: number;
  leaseMilliseconds: number;
  drainTimeoutMilliseconds: number;
  workerId?: string;
}

export interface CharacterWorkerLog {
  level: "info" | "error";
  message: string;
  context: Record<string, unknown>;
}

export async function runCharacterWorker(
  config: CharacterWorkerConfig,
  options: {
    signal: AbortSignal;
    onLog?: (entry: CharacterWorkerLog) => void;
  },
): Promise<void> {
  const log = (
    level: CharacterWorkerLog["level"],
    message: string,
    context: Record<string, unknown>,
  ) => options.onLog?.({ level, message, context });
  const database = createDatabase(config.databaseUrl, config.databasePoolMax, {
    applicationName: "motionprep-worker-character",
    onError: (error) =>
      log("error", "database.pool_error", {
        error_code:
          "code" in error && typeof error.code === "string"
            ? error.code
            : "DATABASE_POOL_ERROR",
      }),
  });
  const rawStorage = new S3ObjectStorage(config.objectStorage);
  const storage = new LeaseGuardedObjectStorage(
    rawStorage,
    new PostgresObjectWriteLeaseCoordinator(database.pool),
  );
  const jobs = new PostgresCharacterJobRepository(database.pool);
  const characterRigs = new PostgresCharacterRigRepository(database.pool);
  const resultCommitter = new PostgresCharacterJobResultCommitter(database.pool);
  const provider = new HttpCharacterInferenceProvider({
    baseUrl: config.inferenceBaseUrl,
    apiKey: config.inferenceApiKey,
    timeoutMilliseconds: config.inferenceTimeoutMilliseconds,
    allowInsecureLocalhost: config.allowInsecureLocalhost,
  });
  const instanceId =
    config.workerId ??
    `${hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
  const drain = new WorkerDrainCoordinator<{
    jobId: string;
    workerId: string;
  }>({
    timeoutMilliseconds: config.drainTimeoutMilliseconds,
    release: async ({ jobId, workerId }) => {
      const released = await jobs.releaseClaim(
        jobId,
        workerId,
        new Date().toISOString(),
      );
      if (!released) return;
      await recordWorkerEvent(database.pool, {
        workerType: "character",
        eventType: "retry",
        jobId,
      }).catch((error: unknown) =>
        log("error", "worker.event_record_failed", {
          job_id: jobId,
          error: error instanceof Error ? error.message : "unknown",
        }),
      );
      log("info", "character.shutdown_requeued", {
        job_id: jobId,
        worker_id: workerId,
      });
    },
    onReleaseError: (error, item) =>
      log("error", "character.shutdown_requeue_failed", {
        job_id: item.jobId,
        worker_id: item.workerId,
        error: error instanceof Error ? error.message : "unknown",
      }),
  });
  const requestDrain = () => {
    log("info", "worker.drain_started", {
      active_jobs: drain.activeCount,
      drain_timeout_ms: config.drainTimeoutMilliseconds,
    });
    drain.requestShutdown();
  };
  options.signal.addEventListener("abort", requestDrain, { once: true });
  if (options.signal.aborted) requestDrain();

  await Promise.all([database.ready(), rawStorage.ready(false)]);
  log("info", "worker.ready", {
    worker_id: instanceId,
    concurrency: config.concurrency,
    lease_ms: config.leaseMilliseconds,
  });
  const heartbeat = await startWorkerHeartbeat(database.pool, {
    instanceId,
    workerType: "character",
    releaseVersion: process.env.RELEASE_VERSION ?? "development",
    concurrency: config.concurrency,
    ...(process.env.WORKER_HEALTH_INSTANCE_FILE
      ? { healthInstanceFile: process.env.WORKER_HEALTH_INSTANCE_FILE }
      : {}),
    onError: (error) =>
      log("error", "worker.heartbeat_failed", {
        error: error instanceof Error ? error.message : "unknown",
      }),
  });

  try {
    const loops = Array.from({ length: config.concurrency }, (_, index) => {
      const workerId = `${instanceId}:${index + 1}`;
      return runCharacterWorkerLoop({
        jobs,
        characterRigs,
        resultCommitter,
        provider,
        storage,
        workerId,
        leaseMilliseconds: config.leaseMilliseconds,
        pollMilliseconds: config.pollMilliseconds,
        signal: options.signal,
        onClaimed: (job) =>
          drain.register(workerId, { jobId: job.id, workerId }),
        onFinished: () => drain.unregister(workerId),
        onLoopError: (error) =>
          log("error", "character.worker_loop_failed", {
            worker_id: workerId,
            error: error instanceof Error ? error.message : "unknown",
          }),
        onArtifactCleanupError: (error, objectKey) =>
          log("error", "character.artifact_cleanup_failed", {
            object_key: objectKey,
            error: error instanceof Error ? error.message : "unknown",
          }),
        onSettled: async (job, durationMs) => {
          const eventType =
            job.status === "succeeded"
              ? "completed"
              : job.status === "failed"
                ? "failed"
                : "retry";
          await recordWorkerEvent(database.pool, {
            workerType: "character",
            eventType,
            jobId: job.id,
            ...(eventType === "completed" ? { durationMs } : {}),
          }).catch((error: unknown) =>
            log("error", "worker.event_record_failed", {
              job_id: job.id,
              error: error instanceof Error ? error.message : "unknown",
            }),
          );
          log(
            job.status === "failed" ? "error" : "info",
            "character.job_settled",
            {
              job_id: job.id,
              project_id: job.projectId,
              status: job.status,
              attempt: job.attempt,
              error_code: job.errorCode,
            },
          );
        },
      });
    });
    const loopsSettled = Promise.allSettled(loops);
    const drainCompleted = waitForAbort(options.signal).then(() =>
      drain.waitForRelease(),
    );
    await Promise.race([loopsSettled, drainCompleted]);
  } finally {
    options.signal.removeEventListener("abort", requestDrain);
    await heartbeat.stop();
    await database.close();
    rawStorage.destroy();
  }
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
