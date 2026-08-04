import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const durableProductionEnvironment = {
  NODE_ENV: "production",
  RELEASE_VERSION: "a".repeat(40),
  PERSISTENCE_MODE: "postgres",
  DATABASE_URL:
    "postgresql://motionprep:secret@db:5432/motionprep?sslmode=require",
  REDIS_URL: "rediss://cache:6379",
  METRICS_BEARER_TOKEN: "metrics-test-token-at-least-32-characters",
  COOKIE_SECURE: "true",
  WEB_ORIGIN: "https://studio.example.com",
  OBJECT_STORAGE_MODE: "s3",
  OBJECT_STORAGE_REGION: "eu-central-1",
  OBJECT_STORAGE_BUCKET: "motionprep-production",
  OBJECT_STORAGE_FORCE_PATH_STYLE: "false",
  OBJECT_STORAGE_ENCRYPTION_MODE: "bucket-default",
  OBJECT_STORAGE_REQUIRE_VERSIONING: "true",
  PROCESSING_EXECUTION_MODE: "worker",
  EXPORT_EXECUTION_MODE: "worker",
  PDF_OCR_MODE: "local",
  PAYMENT_MODE: "disabled",
  AUTH_ENCRYPTION_KEY: "bW90aW9ucHJlcC1sb2NhbC1kZXYta2V5LTMyYnl0ZXM=",
  EMAIL_DELIVERY_MODE: "smtp",
  SMTP_HOST: "smtp.example.com",
  SMTP_USER: "motionprep",
  SMTP_PASSWORD: "smtp-secret",
  SMTP_FROM: "security@example.com",
  SMTP_REQUIRE_TLS: "true",
} as const;

describe("production configuration", () => {
  it("requires an immutable Git SHA as the production release identity", () => {
    expect(() =>
      loadConfig({
        ...durableProductionEnvironment,
        RELEASE_VERSION: "development",
      }),
    ).toThrow(/40-character release Git SHA/u);

    expect(loadConfig(durableProductionEnvironment).RELEASE_VERSION).toBe(
      "a".repeat(40),
    );
  });

  it("rejects volatile storage, insecure cookies, and missing Redis", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        PERSISTENCE_MODE: "memory",
        COOKIE_SECURE: "false",
      }),
    ).toThrow();
  });

  it("accepts explicit durable production dependencies", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      RELEASE_VERSION: "a".repeat(40),
      PERSISTENCE_MODE: "postgres",
      DATABASE_URL:
        "postgresql://motionprep:secret@db:5432/motionprep?sslmode=require",
      REDIS_URL: "rediss://cache:6379",
      METRICS_BEARER_TOKEN: "metrics-test-token-at-least-32-characters",
      COOKIE_SECURE: "true",
      TRUST_PROXY_HOPS: "1",
      WEB_ORIGIN: "https://studio.example.com",
      OBJECT_STORAGE_MODE: "s3",
      OBJECT_STORAGE_REGION: "eu-central-1",
      OBJECT_STORAGE_BUCKET: "motionprep-production",
      OBJECT_STORAGE_ACCESS_KEY: "production-access",
      OBJECT_STORAGE_SECRET_KEY: "production-secret",
      OBJECT_STORAGE_FORCE_PATH_STYLE: "false",
      OBJECT_STORAGE_ENCRYPTION_MODE: "bucket-default",
      OBJECT_STORAGE_REQUIRE_VERSIONING: "true",
      PROCESSING_EXECUTION_MODE: "worker",
      EXPORT_EXECUTION_MODE: "worker",
      PDF_OCR_MODE: "local",
      PAYMENT_MODE: "disabled",
      AUTH_ENCRYPTION_KEY:
        "bW90aW9ucHJlcC1sb2NhbC1kZXYta2V5LTMyYnl0ZXM=",
      EMAIL_DELIVERY_MODE: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "motionprep",
      SMTP_PASSWORD: "smtp-secret",
      SMTP_FROM: "security@example.com",
      SMTP_REQUIRE_TLS: "true",
    });

    expect(config.PERSISTENCE_MODE).toBe("postgres");
    expect(config.COOKIE_SECURE).toBe(true);
    expect(config.TRUST_PROXY_HOPS).toBe(1);
    expect(config.DATABASE_POOL_MAX).toBe(10);
    expect(config.OBJECT_STORAGE_MODE).toBe("s3");
    expect(config.OBJECT_STORAGE_FORCE_PATH_STYLE).toBe(false);
    expect(config.OBJECT_STORAGE_ENCRYPTION_MODE).toBe("bucket-default");
    expect(config.PDF_OCR_MODE).toBe("local");
    expect(config.PDF_REGION_OCR_ENABLED).toBe(false);
  });

  it("requires an explicit opt-in for regional OCR", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      PDF_REGION_OCR_ENABLED: "true",
    });

    expect(config.PDF_REGION_OCR_ENABLED).toBe(true);
  });

  it("allows a lower runtime upload policy but rejects values above the product contract", () => {
    expect(
      loadConfig({ NODE_ENV: "test", MAX_UPLOAD_BYTES: "1048576" })
        .MAX_UPLOAD_BYTES,
    ).toBe(1_048_576);
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        MAX_UPLOAD_BYTES: String(30 * 1024 * 1024 + 1),
      }),
    ).toThrow();
  });

  it("bounds raster asset write concurrency independently from job concurrency", () => {
    expect(
      loadConfig({ NODE_ENV: "test" }).RASTER_ASSET_WRITE_CONCURRENCY,
    ).toBe(2);
    expect(
      loadConfig({
        NODE_ENV: "test",
        RASTER_ASSET_WRITE_CONCURRENCY: "4",
      }).RASTER_ASSET_WRITE_CONCURRENCY,
    ).toBe(4);
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        RASTER_ASSET_WRITE_CONCURRENCY: "5",
      }),
    ).toThrow();
  });

  it("rejects plaintext production database, Redis, and SMTP transports", () => {
    expect(() =>
      loadConfig({
        ...durableProductionEnvironment,
        DATABASE_URL: "postgresql://motionprep:secret@db:5432/motionprep",
      }),
    ).toThrow(/must require TLS/u);
    expect(() =>
      loadConfig({
        ...durableProductionEnvironment,
        REDIS_URL: "redis://cache:6379",
      }),
    ).toThrow(/rediss/u);
    expect(() =>
      loadConfig({
        ...durableProductionEnvironment,
        SMTP_REQUIRE_TLS: "false",
      }),
    ).toThrow(/STARTTLS/u);
  });

  it("accepts both PostgreSQL URL schemes when production TLS is explicit", () => {
    for (const protocol of ["postgresql", "postgres"]) {
      expect(() =>
        loadConfig({
          ...durableProductionEnvironment,
          DATABASE_URL:
            `${protocol}://motionprep:secret@db:5432/motionprep` +
            "?sslmode=verify-full",
        }),
      ).not.toThrow();
    }
  });

  it("accepts the AWS default credential provider chain", () => {
    const config = loadConfig(durableProductionEnvironment);

    expect(config.OBJECT_STORAGE_ACCESS_KEY).toBeUndefined();
    expect(config.OBJECT_STORAGE_SECRET_KEY).toBeUndefined();
    expect(config.OBJECT_STORAGE_SESSION_TOKEN).toBeUndefined();
  });

  it("rejects partial explicit object-storage credentials", () => {
    expect(() =>
      loadConfig({
        ...durableProductionEnvironment,
        OBJECT_STORAGE_ACCESS_KEY: "incomplete-access-key",
      }),
    ).toThrow(/must be provided together/u);
  });

  it("rejects a production custom object-storage endpoint without TLS", () => {
    expect(() =>
      loadConfig({
        ...durableProductionEnvironment,
        OBJECT_STORAGE_ENDPOINT: "http://minio.internal:9000",
        OBJECT_STORAGE_ACCESS_KEY: "production-access",
        OBJECT_STORAGE_SECRET_KEY: "production-secret",
      }),
    ).toThrow(/must use HTTPS/u);
  });

  it("requires explicit credentials for a custom S3-compatible endpoint", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "development",
        OBJECT_STORAGE_MODE: "s3",
        OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
        OBJECT_STORAGE_BUCKET: "motionprep-development",
      }),
    ).toThrow(/custom S3-compatible endpoint requires explicit credentials/u);
  });

  it("rejects production object storage without encryption", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        PERSISTENCE_MODE: "postgres",
        DATABASE_URL:
          "postgresql://motionprep:secret@db:5432/motionprep?sslmode=require",
        REDIS_URL: "rediss://cache:6379",
        METRICS_BEARER_TOKEN: "metrics-test-token-at-least-32-characters",
        COOKIE_SECURE: "true",
        OBJECT_STORAGE_MODE: "s3",
        OBJECT_STORAGE_BUCKET: "motionprep-production",
        OBJECT_STORAGE_ACCESS_KEY: "production-access",
        OBJECT_STORAGE_SECRET_KEY: "production-secret",
        OBJECT_STORAGE_ENCRYPTION_MODE: "none",
        OBJECT_STORAGE_REQUIRE_VERSIONING: "true",
        PROCESSING_EXECUTION_MODE: "worker",
        EXPORT_EXECUTION_MODE: "worker",
        PDF_OCR_MODE: "local",
        PAYMENT_MODE: "disabled",
        AUTH_ENCRYPTION_KEY:
          "bW90aW9ucHJlcC1sb2NhbC1kZXYta2V5LTMyYnl0ZXM=",
        EMAIL_DELIVERY_MODE: "smtp",
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "motionprep",
        SMTP_PASSWORD: "smtp-secret",
        SMTP_FROM: "security@example.com",
        SMTP_REQUIRE_TLS: "true",
      }),
    ).toThrow(/SSE-S3|encrypted bucket default/u);
  });

  it("rejects production object storage without versioning", () => {
    expect(() =>
      loadConfig({
        ...durableProductionEnvironment,
        OBJECT_STORAGE_REQUIRE_VERSIONING: "false",
      }),
    ).toThrow(/bucket versioning/u);
  });

  it("treats blank optional secrets as absent", () => {
    const config = loadConfig({
      NODE_ENV: "development",
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: " ",
      SMTP_HOST: "",
      PASSWORD_RESET_URL: "",
      OBJECT_STORAGE_ENDPOINT: "",
    });

    expect(config.STRIPE_SECRET_KEY).toBeUndefined();
    expect(config.STRIPE_WEBHOOK_SECRET).toBeUndefined();
    expect(config.SMTP_HOST).toBeUndefined();
    expect(config.PASSWORD_RESET_URL).toBeUndefined();
    expect(config.OBJECT_STORAGE_ENDPOINT).toBeUndefined();
  });

  it("rejects non-canonical Base64 authentication keys", () => {
    const valid = Buffer.alloc(32, 1).toString("base64");
    expect(
      loadConfig({ NODE_ENV: "test", AUTH_ENCRYPTION_KEY: valid })
        .AUTH_ENCRYPTION_KEY,
    ).toBe(valid);
    expect(() =>
      loadConfig({ NODE_ENV: "test", AUTH_ENCRYPTION_KEY: `!${valid}` }),
    ).toThrow(/canonical Base64/u);
  });
});
