import assert from "node:assert/strict";
import test from "node:test";
import type { runCharacterWorker } from "@motionprep/api/character-worker";
import { main } from "./index.js";

const environment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://motionprep:test@localhost:5432/motionprep",
  OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
  OBJECT_STORAGE_BUCKET: "motionprep-test",
  OBJECT_STORAGE_ACCESS_KEY: "motionprep",
  OBJECT_STORAGE_SECRET_KEY: "motionprep-test",
  OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
  OBJECT_STORAGE_ENCRYPTION_MODE: "none",
  OBJECT_STORAGE_REQUIRE_VERSIONING: "false",
  CHARACTER_INFERENCE_URL: "http://127.0.0.1:8188/",
  CHARACTER_INFERENCE_API_KEY: "character-test-api-key",
  CHARACTER_INFERENCE_ALLOW_INSECURE_LOCALHOST: "true",
  CHARACTER_WORKER_ID: "character-test",
} as const;

test("maps validated environment into the character runtime", async () => {
  let received: Parameters<typeof runCharacterWorker>[0] | undefined;
  await main(async (config, options) => {
    received = config;
    process.emit("SIGTERM");
    assert.equal(options.signal.aborted, true);
    options.onLog?.({
      level: "info",
      message: "test.ready",
      context: { worker: "character" },
    });
  }, environment);

  assert.equal(received?.databaseUrl, environment.DATABASE_URL);
  assert.equal(received?.workerId, "character-test");
  assert.equal(received?.objectStorage.bucket, "motionprep-test");
  assert.equal(received?.inferenceTimeoutMilliseconds, 300_000);
});
