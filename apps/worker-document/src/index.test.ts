import assert from "node:assert/strict";
import test from "node:test";
import type { runProcessingWorker } from "@motionprep/api/processing-worker";
import { main } from "./index.js";

test("starts the document processing worker with the book identity", async () => {
  let received: Parameters<typeof runProcessingWorker>[0] | undefined;
  await main(async (options) => {
    received = options;
  });
  assert.deepEqual(received, {
    projectKind: "book",
    serviceName: "motionprep-worker-document",
  });
});
