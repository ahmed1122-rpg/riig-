import { runProcessingWorker } from "@motionprep/api/processing-worker";
import { pathToFileURL } from "node:url";

export async function main(
  run: typeof runProcessingWorker = runProcessingWorker,
): Promise<void> {
  await run({
    projectKind: "book",
    serviceName: "motionprep-worker-document",
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
