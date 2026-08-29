import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadCharacterWorkerConfig } from "./config.js";

const baseEnvironment = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://motionprep:secret@db:5432/motionprep",
  OBJECT_STORAGE_BUCKET: "motionprep-production",
  OBJECT_STORAGE_ENCRYPTION_MODE: "bucket-default",
  OBJECT_STORAGE_REQUIRE_VERSIONING: "true",
} as const;

describe("character worker configuration", () => {
  it("runs the source-preserving compiler without provider credentials", () => {
    const config = loadCharacterWorkerConfig(baseEnvironment);
    assert.equal(config.CHARACTER_CONCURRENCY, 1);
    assert.equal(config.CHARACTER_LEASE_MS, 600_000);
    assert.equal(config.CHARACTER_DRAIN_TIMEOUT_MS, 30_000);
  });

  it("accepts bounded worker overrides", () => {
    const config = loadCharacterWorkerConfig({
      ...baseEnvironment,
      CHARACTER_CONCURRENCY: "2",
      CHARACTER_POLL_MS: "500",
      CHARACTER_LEASE_MS: "120000",
      CHARACTER_DRAIN_TIMEOUT_MS: "15000",
      CHARACTER_WORKER_ID: "character-primary",
    });
    assert.equal(config.CHARACTER_CONCURRENCY, 2);
    assert.equal(config.CHARACTER_POLL_MS, 500);
    assert.equal(config.CHARACTER_LEASE_MS, 120_000);
    assert.equal(config.CHARACTER_DRAIN_TIMEOUT_MS, 15_000);
    assert.equal(config.CHARACTER_WORKER_ID, "character-primary");
  });

  it("rejects unsafe concurrency and lease values", () => {
    assert.throws(() =>
      loadCharacterWorkerConfig({
        ...baseEnvironment,
        CHARACTER_CONCURRENCY: "5",
      }),
    );
    assert.throws(() =>
      loadCharacterWorkerConfig({
        ...baseEnvironment,
        CHARACTER_LEASE_MS: "1000",
      }),
    );
  });
});
