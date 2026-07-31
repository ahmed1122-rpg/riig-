import assert from "node:assert/strict";
import test from "node:test";
import type { runProcessingWorker } from "@motionprep/api/processing-worker";
import { main } from "./index.js";

test("starts the image processing worker with the media identity", async () => {
  let received: Parameters<typeof runProcessingWorker>[0] | undefined;
  await main(async (options) => {
    received = options;
  });
  assert.deepEqual(received, {
    projectKind: "image",
    serviceName: "motionprep-worker-media",
  });
});
