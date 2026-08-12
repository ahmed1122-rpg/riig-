import { runCharacterWorker } from "@motionprep/api/character-worker";
import { createS3ObjectStorageOptions } from "@motionprep/api/object-storage-environment";
import { initializeTracing } from "@motionprep/api/tracing";
import { pathToFileURL } from "node:url";
import { loadCharacterWorkerConfig } from "./config.js";
import { writeCharacterWorkerLog } from "./structured-log.js";

export async function main(
  run: typeof runCharacterWorker = runCharacterWorker,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const config = loadCharacterWorkerConfig(environment);
  const tracing = initializeTracing("motionprep-worker-character", environment);
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
        inferenceBaseUrl: config.CHARACTER_INFERENCE_URL,
        inferenceApiKey: config.CHARACTER_INFERENCE_API_KEY,
        inferenceTimeoutMilliseconds: config.CHARACTER_INFERENCE_TIMEOUT_MS,
        allowInsecureLocalhost:
          config.CHARACTER_INFERENCE_ALLOW_INSECURE_LOCALHOST,
        pollMilliseconds: config.CHARACTER_POLL_MS,
        concurrency: config.CHARACTER_CONCURRENCY,
        leaseMilliseconds: config.CHARACTER_LEASE_MS,
        drainTimeoutMilliseconds: config.CHARACTER_DRAIN_TIMEOUT_MS,
        ...(config.CHARACTER_WORKER_ID
          ? { workerId: config.CHARACTER_WORKER_ID }
          : {}),
      },
      {
        signal: controller.signal,
        onLog: writeCharacterWorkerLog,
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
