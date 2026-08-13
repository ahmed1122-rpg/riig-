import { runExportWorker } from "@motionprep/api/export-worker";
import { createS3ObjectStorageOptions } from "@motionprep/api/object-storage-environment";
import { initializeTracing } from "@motionprep/api/tracing";
import { pathToFileURL } from "node:url";
import { loadExportWorkerConfig } from "./config.js";

export async function main(
  run: typeof runExportWorker = runExportWorker,
  environment: NodeJS.ProcessEnv = process.env,
  terminate: (code: number) => never = process.exit,
): Promise<void> {
  const config = loadExportWorkerConfig(environment);
  const tracing = initializeTracing("motionprep-worker-export", environment);
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);

  try {
    await run(
      {
        databaseUrl: config.DATABASE_URL,
        databasePoolMax: config.DATABASE_POOL_MAX,
        objectStorage: createS3ObjectStorageOptions(config),
        pollMilliseconds: config.EXPORT_POLL_MS,
        concurrency: config.EXPORT_CONCURRENCY,
        leaseMilliseconds: config.EXPORT_LEASE_MS,
        drainTimeoutMilliseconds: config.EXPORT_DRAIN_TIMEOUT_MS,
        jobTimeoutMilliseconds: config.EXPORT_JOB_TIMEOUT_MS,
        sharpCacheMemoryMb: config.SHARP_CACHE_MEMORY_MB,
        sharpConcurrency: config.SHARP_CONCURRENCY,
        ...(config.EXPORT_WORKER_ID
          ? { workerId: config.EXPORT_WORKER_ID }
          : {}),
      },
      {
        signal: controller.signal,
        onLog: ({ level, message, context }) => {
          process.stdout.write(
            `${JSON.stringify({
              timestamp: new Date().toISOString(),
              level,
              service: "motionprep-worker-export",
              message,
              context,
            })}\n`,
          );
        },
        onJobTimeout: (jobId) => {
          process.stderr.write(
            `${JSON.stringify({
              timestamp: new Date().toISOString(),
              level: "error",
              service: "motionprep-worker-export",
              message: "worker.recycle_after_export_deadline",
              context: { job_id: jobId },
            })}\n`,
          );
          // Export adapters are native/buffer-oriented and cannot be cancelled
          // safely in-process. Exit before the service can settle a competing
          // terminal state; the lease expires and the supervisor starts a clean
          // process with its memory returned to the OS.
          terminate(1);
        },
      },
    );
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
    await tracing.shutdown();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
