import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadCharacterWorkerConfig } from "./config.js";

const baseEnvironment = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://motionprep:secret@db:5432/motionprep",
  OBJECT_STORAGE_BUCKET: "motionprep-production",
  OBJECT_STORAGE_ENCRYPTION_MODE: "bucket-default",
  OBJECT_STORAGE_REQUIRE_VERSIONING: "true",
  CHARACTER_INFERENCE_URL: "https://character-inference.internal/",
  CHARACTER_INFERENCE_API_KEY: "private-worker-key-with-sufficient-length",
} as const;

describe("character worker configuration", () => {
  it("uses conservative single-worker defaults", () => {
    const config = loadCharacterWorkerConfig(baseEnvironment);
    assert.equal(config.CHARACTER_CONCURRENCY, 1);
    assert.equal(config.CHARACTER_LEASE_MS, 600_000);
    assert.equal(config.CHARACTER_INFERENCE_TIMEOUT_MS, 300_000);
  });

  it("rejects insecure non-local inference endpoints", () => {
    assert.throws(
      () =>
        loadCharacterWorkerConfig({
          ...baseEnvironment,
          NODE_ENV: "development",
          OBJECT_STORAGE_ENCRYPTION_MODE: "none",
          OBJECT_STORAGE_REQUIRE_VERSIONING: "false",
          CHARACTER_INFERENCE_URL: "http://inference.internal/",
          CHARACTER_INFERENCE_ALLOW_INSECURE_LOCALHOST: "true",
        }),
      /requires HTTPS/u,
    );
  });

  it("allows explicit insecure localhost only for development", () => {
    const config = loadCharacterWorkerConfig({
      ...baseEnvironment,
      NODE_ENV: "development",
      OBJECT_STORAGE_ENCRYPTION_MODE: "none",
      OBJECT_STORAGE_REQUIRE_VERSIONING: "false",
      CHARACTER_INFERENCE_URL: "http://127.0.0.1:8188/",
      CHARACTER_INFERENCE_ALLOW_INSECURE_LOCALHOST: "true",
    });
    assert.equal(config.CHARACTER_INFERENCE_ALLOW_INSECURE_LOCALHOST, true);
  });
});
