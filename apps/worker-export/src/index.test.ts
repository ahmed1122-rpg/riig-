import assert from "node:assert/strict";
import test from "node:test";
import type { runExportWorker } from "@motionprep/api/export-worker";
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
  EXPORT_WORKER_ID: "export-test",
} as const;

test("maps validated environment into the export runtime", async () => {
  let received: Parameters<typeof runExportWorker>[0] | undefined;
  await main(async (config, options) => {
    received = config;
    assert.ok(options);
    process.emit("SIGTERM");
    assert.equal(options.signal?.aborted, true);
    options.onLog?.({
      level: "info",
      message: "test.ready",
      context: { worker: "export" },
    });
  }, environment);

  assert.equal(received?.databaseUrl, environment.DATABASE_URL);
  assert.equal(received?.workerId, "export-test");
  assert.equal(received?.objectStorage.bucket, "motionprep-test");
  assert.equal(received?.objectStorage.requireVersioning, false);
});
