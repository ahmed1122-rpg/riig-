import { describe, expect, it } from "vitest";
import { loadProcessingWorkerConfig } from "./processing-worker-config.js";

const baseEnvironment = {
  DATABASE_URL: "postgresql://motionprep:secret@db:5432/motionprep",
  OBJECT_STORAGE_BUCKET: "motionprep-production",
  OBJECT_STORAGE_ENCRYPTION_MODE: "bucket-default",
  OBJECT_STORAGE_REQUIRE_VERSIONING: "true",
} as const;

describe("processing worker object-storage configuration", () => {
  it("accepts workload identity without static credentials", () => {
    const config = loadProcessingWorkerConfig({
      ...baseEnvironment,
      NODE_ENV: "production",
    });

    expect(config.OBJECT_STORAGE_ACCESS_KEY).toBeUndefined();
    expect(config.OBJECT_STORAGE_SECRET_KEY).toBeUndefined();
    expect(config.PROCESSING_DRAIN_TIMEOUT_MS).toBe(30_000);
  });

  it("accepts temporary explicit credentials", () => {
    const config = loadProcessingWorkerConfig({
      ...baseEnvironment,
      NODE_ENV: "production",
      OBJECT_STORAGE_ACCESS_KEY: "temporary-access",
      OBJECT_STORAGE_SECRET_KEY: "temporary-secret",
      OBJECT_STORAGE_SESSION_TOKEN: "temporary-session",
    });

    expect(config.OBJECT_STORAGE_SESSION_TOKEN).toBe("temporary-session");
  });

  it("rejects partial explicit credentials", () => {
    expect(() =>
      loadProcessingWorkerConfig({
        ...baseEnvironment,
        OBJECT_STORAGE_ACCESS_KEY: "incomplete",
      }),
    ).toThrow(/must be provided together/u);
  });

  it("rejects a session token without an explicit credential pair", () => {
    expect(() =>
      loadProcessingWorkerConfig({
        ...baseEnvironment,
        OBJECT_STORAGE_SESSION_TOKEN: "orphan-session",
      }),
    ).toThrow(/requires explicit access and secret keys/u);
  });

  it("requires explicit credentials for a custom endpoint", () => {
    expect(() =>
      loadProcessingWorkerConfig({
        ...baseEnvironment,
        OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
      }),
    ).toThrow(/custom S3-compatible endpoint requires explicit credentials/u);
  });

  it("rejects an insecure custom production endpoint", () => {
    expect(() =>
      loadProcessingWorkerConfig({
        ...baseEnvironment,
        NODE_ENV: "production",
        OBJECT_STORAGE_ENDPOINT: "http://minio.internal:9000",
        OBJECT_STORAGE_ACCESS_KEY: "production-access",
        OBJECT_STORAGE_SECRET_KEY: "production-secret",
      }),
    ).toThrow(/must use HTTPS/u);
  });

  it("rejects unencrypted production object storage", () => {
    expect(() =>
      loadProcessingWorkerConfig({
        ...baseEnvironment,
        NODE_ENV: "production",
        OBJECT_STORAGE_ENCRYPTION_MODE: "none",
        OBJECT_STORAGE_REQUIRE_VERSIONING: "true",
      }),
    ).toThrow(/require encrypted object storage/u);
  });
});
