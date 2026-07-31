import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadExportWorkerConfig } from "./config.js";

const baseEnvironment = {
  DATABASE_URL: "postgresql://motionprep:secret@db:5432/motionprep",
  OBJECT_STORAGE_BUCKET: "motionprep-production",
  OBJECT_STORAGE_ENCRYPTION_MODE: "bucket-default",
  OBJECT_STORAGE_REQUIRE_VERSIONING: "true",
} as const;

describe("export worker object-storage configuration", () => {
  it("accepts workload identity without static credentials", () => {
    const config = loadExportWorkerConfig({
      ...baseEnvironment,
      NODE_ENV: "production",
    });

    assert.equal(config.OBJECT_STORAGE_ACCESS_KEY, undefined);
    assert.equal(config.OBJECT_STORAGE_SECRET_KEY, undefined);
    assert.equal(config.EXPORT_DRAIN_TIMEOUT_MS, 30_000);
  });

  it("accepts temporary explicit credentials", () => {
    const config = loadExportWorkerConfig({
      ...baseEnvironment,
      NODE_ENV: "production",
      OBJECT_STORAGE_ACCESS_KEY: "temporary-access",
      OBJECT_STORAGE_SECRET_KEY: "temporary-secret",
      OBJECT_STORAGE_SESSION_TOKEN: "temporary-session",
    });

    assert.equal(config.OBJECT_STORAGE_SESSION_TOKEN, "temporary-session");
  });

  it("rejects partial explicit credentials", () => {
    assert.throws(
      () =>
        loadExportWorkerConfig({
          ...baseEnvironment,
          OBJECT_STORAGE_ACCESS_KEY: "incomplete",
        }),
      /must be provided together/u,
    );
  });

  it("rejects a session token without an explicit credential pair", () => {
    assert.throws(
      () =>
        loadExportWorkerConfig({
          ...baseEnvironment,
          OBJECT_STORAGE_SESSION_TOKEN: "orphan-session",
        }),
      /requires explicit access and secret keys/u,
    );
  });

  it("requires explicit credentials for a custom endpoint", () => {
    assert.throws(
      () =>
        loadExportWorkerConfig({
          ...baseEnvironment,
          OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
        }),
      /custom S3-compatible endpoint requires explicit credentials/u,
    );
  });

  it("rejects an insecure custom production endpoint", () => {
    assert.throws(
      () =>
        loadExportWorkerConfig({
          ...baseEnvironment,
          NODE_ENV: "production",
          OBJECT_STORAGE_ENDPOINT: "http://minio.internal:9000",
          OBJECT_STORAGE_ACCESS_KEY: "production-access",
          OBJECT_STORAGE_SECRET_KEY: "production-secret",
        }),
      /must use HTTPS/u,
    );
  });

  it("rejects unencrypted production object storage", () => {
    assert.throws(
      () =>
        loadExportWorkerConfig({
          ...baseEnvironment,
          NODE_ENV: "production",
          OBJECT_STORAGE_ENCRYPTION_MODE: "none",
          OBJECT_STORAGE_REQUIRE_VERSIONING: "true",
        }),
      /require encrypted object storage/u,
    );
  });
});
