import { runMalwareScanWorker } from "@motionprep/api/malware-scan-worker";
import { initializeTracing } from "@motionprep/api/tracing";
import { pathToFileURL } from "node:url";

export async function main(
  run: typeof runMalwareScanWorker = runMalwareScanWorker,
): Promise<void> {
  const tracing = initializeTracing("motionprep-worker-security", process.env);
  try {
    await run();
  } finally {
    await tracing.shutdown();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
