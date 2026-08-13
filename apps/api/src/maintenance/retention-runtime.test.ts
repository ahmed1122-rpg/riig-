import { describe, expect, it } from "vitest";
import { loadRetentionRuntimeEnvironment } from "./retention-runtime.js";

describe("retention runtime environment", () => {
  it("starts with database and object-storage credentials only", () => {
    const config = loadRetentionRuntimeEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://maintenance:x@db/app?sslmode=require",
      OBJECT_STORAGE_REGION: "eu-central-1",
      OBJECT_STORAGE_BUCKET: "motionprep-production",
      OBJECT_STORAGE_ENCRYPTION_MODE: "bucket-default",
      OBJECT_STORAGE_REQUIRE_VERSIONING: "true",
    });
    expect(config.DATABASE_URL).toContain("maintenance");
    expect(config.OBJECT_STORAGE_BUCKET).toBe("motionprep-production");
  });

  it("does not require API authentication, SMTP, Redis, or Stripe secrets", () => {
    expect(() =>
      loadRetentionRuntimeEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://maintenance:x@db/app?sslmode=require",
        OBJECT_STORAGE_REGION: "eu-central-1",
        OBJECT_STORAGE_BUCKET: "motionprep-production",
        OBJECT_STORAGE_ENCRYPTION_MODE: "bucket-default",
        OBJECT_STORAGE_REQUIRE_VERSIONING: "true",
      }),
    ).not.toThrow();
  });
});
