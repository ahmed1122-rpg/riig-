import { runProcessingWorker } from "@motionprep/api/processing-worker";
import { initializeTracing } from "@motionprep/api/tracing";
import { pathToFileURL } from "node:url";

export async function main(
  run: typeof runProcessingWorker = runProcessingWorker,
): Promise<void> {
  const tracing = initializeTracing("motionprep-worker-document", process.env);
  try {
    await run({
      projectKind: "book",
      serviceName: "motionprep-worker-document",
    });
  } finally {
    await tracing.shutdown();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
