import { runExportWorker } from "@motionprep/api/export-worker";
import { createS3ObjectStorageOptions } from "@motionprep/api/object-storage-environment";
import { pathToFileURL } from "node:url";
import { loadExportWorkerConfig } from "./config.js";

export async function main(
  run: typeof runExportWorker = runExportWorker,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const config = loadExportWorkerConfig(environment);
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
      },
    );
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
