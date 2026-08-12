import { hostname } from "node:os";
import type { S3ObjectStorageOptions } from "../storage/s3-object-storage.js";
import { S3ObjectStorage } from "../storage/s3-object-storage.js";
import { createDatabase } from "../infrastructure/postgres/database.js";
import { PostgresCharacterJobRepository } from "../infrastructure/postgres/postgres-character-job-repository.js";
import { PostgresCharacterRigRepository } from "../infrastructure/postgres/postgres-character-rig-repository.js";
import { startWorkerHeartbeat } from "../observability/worker-heartbeat.js";
import { recordWorkerEvent } from "../observability/worker-events.js";
import { HttpCharacterInferenceProvider } from "./http-character-inference-provider.js";
import { runCharacterWorkerLoop } from "./character-worker-loop.js";

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
  const storage = new S3ObjectStorage(config.objectStorage);
  const jobs = new PostgresCharacterJobRepository(database.pool);
  const characterRigs = new PostgresCharacterRigRepository(database.pool);
  const provider = new HttpCharacterInferenceProvider({
    baseUrl: config.inferenceBaseUrl,
    apiKey: config.inferenceApiKey,
    timeoutMilliseconds: config.inferenceTimeoutMilliseconds,
    allowInsecureLocalhost: config.allowInsecureLocalhost,
  });
  const instanceId =
    config.workerId ??
    `${hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;

  await Promise.all([database.ready(), storage.ready(false)]);
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
    onError: (error) =>
      log("error", "worker.heartbeat_failed", {
        error: error instanceof Error ? error.message : "unknown",
      }),
  });

  try {
    await Promise.all(
      Array.from({ length: config.concurrency }, (_, index) => {
        const workerId = `${instanceId}:${index + 1}`;
        return runCharacterWorkerLoop({
          jobs,
          characterRigs,
          provider,
          storage,
          workerId,
          leaseMilliseconds: config.leaseMilliseconds,
          pollMilliseconds: config.pollMilliseconds,
          signal: options.signal,
          onArtifactCleanupError: (error, objectKey) =>
            log("error", "character.artifact_cleanup_failed", {
              object_key: objectKey,
              error: error instanceof Error ? error.message : "unknown",
            }),
          onSettled: async (job) => {
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
            }).catch((error: unknown) =>
              log("error", "worker.event_record_failed", {
                job_id: job.id,
                error: error instanceof Error ? error.message : "unknown",
              }),
            );
            log(job.status === "failed" ? "error" : "info", "character.job_settled", {
              job_id: job.id,
              project_id: job.projectId,
              status: job.status,
              attempt: job.attempt,
              error_code: job.errorCode,
            });
          },
        });
      }),
    );
  } finally {
    await heartbeat.stop();
    await database.close();
    storage.destroy();
  }
}
