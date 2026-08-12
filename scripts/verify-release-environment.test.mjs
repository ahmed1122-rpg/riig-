import assert from "node:assert/strict";
import test from "node:test";
import {
  validateProductionEnvironment,
  validateReleaseEnvironment,
} from "./verify-release-environment.mjs";

test("accepts two digest-qualified release references", () => {
  const source = [
    `RELEASE_GIT_SHA=${"c".repeat(40)}`,
    `RUNTIME_IMAGE_REF=ghcr.io/example/runtime@sha256:${"a".repeat(64)}`,
    `WEB_IMAGE_REF=ghcr.io/example/web@sha256:${"b".repeat(64)}`,
  ].join("\n");
  assert.deepEqual(validateReleaseEnvironment(source), []);
});

test("rejects mutable tags and legacy variables", () => {
  const violations = validateReleaseEnvironment(
    `RELEASE_GIT_SHA=${"c".repeat(40)}\nRUNTIME_IMAGE_REF=example/runtime:latest\nWEB_IMAGE_REF=example/web:v1\nIMAGE_TAG=v1`,
  );
  assert.equal(violations.length, 3);
});

test("accepts a complete production environment", () => {
  const source = completeEnvironment();
  assert.deepEqual(validateProductionEnvironment(source), []);
});

test("rejects regional OCR without current sealed holdout evidence", () => {
  const source = completeEnvironment().replace(
    "PDF_REGION_OCR_ENABLED=false",
    "PDF_REGION_OCR_ENABLED=true",
  );
  assert.match(
    validateProductionEnvironment(source).join("\n"),
    /sealed OCR holdout evidence/u,
  );
  assert.deepEqual(
    validateProductionEnvironment(source, { ocrEvidenceCurrent: true }),
    [],
  );
});

test("rejects placeholders, plaintext dependencies, and incomplete live billing", () => {
  const source = completeEnvironment()
    .replace("NODE_ENV=production", "NODE_ENV=development")
    .replace("REDIS_URL=rediss://cache.example.com:6379", "REDIS_URL=redis://cache.example.com:6379")
    .replace("SMTP_PASSWORD=secure-smtp-password", "SMTP_PASSWORD=CHANGE_ME")
    .replace("PAYMENT_MODE=disabled", "PAYMENT_MODE=live");
  const violations = validateProductionEnvironment(source);
  assert.match(violations.join("\n"), /NODE_ENV must be production/u);
  assert.match(violations.join("\n"), /REDIS_URL must use rediss:/u);
  assert.match(violations.join("\n"), /SMTP_PASSWORD still contains/u);
  assert.match(violations.join("\n"), /STRIPE_SECRET_KEY is required/u);
});

function completeEnvironment() {
  return [
    "NODE_ENV=production",
    `RELEASE_GIT_SHA=${"c".repeat(40)}`,
    "PERSISTENCE_MODE=postgres",
    "DATABASE_URL=postgres://user:password@db.example.com:5432/motionprep?sslmode=verify-full",
    "REDIS_URL=rediss://cache.example.com:6379",
    `AUTH_ENCRYPTION_KEY=${Buffer.alloc(32, 7).toString("base64")}`,
    "COOKIE_SECURE=true",
    "METRICS_BEARER_TOKEN=metrics-token-with-at-least-32-characters",
    "WEB_ORIGIN=https://studio.example.com",
    "TRUSTED_PROXY_CIDR=10.20.0.0/24",
    "TRUST_PROXY_HOPS=1",
    "PASSWORD_RESET_URL=https://studio.example.com/auth/reset",
    "EMAIL_DELIVERY_MODE=smtp",
    "SMTP_HOST=smtp.example.com",
    "SMTP_USER=motionprep",
    "SMTP_PASSWORD=secure-smtp-password",
    "SMTP_FROM=security@example.com",
    "SMTP_SECURE=false",
    "SMTP_REQUIRE_TLS=true",
    "OBJECT_STORAGE_MODE=s3",
    "OBJECT_STORAGE_REGION=eu-central-1",
    "OBJECT_STORAGE_BUCKET=motionprep-production",
    "OBJECT_STORAGE_ENCRYPTION_MODE=bucket-default",
    "OBJECT_STORAGE_REQUIRE_VERSIONING=true",
    "PROCESSING_EXECUTION_MODE=worker",
    "EXPORT_EXECUTION_MODE=worker",
    "PAYMENT_MODE=disabled",
    "PDF_REGION_OCR_ENABLED=false",
    `RUNTIME_IMAGE_REF=ghcr.io/example/runtime@sha256:${"a".repeat(64)}`,
    `WEB_IMAGE_REF=ghcr.io/example/web@sha256:${"b".repeat(64)}`,
  ].join("\n");
}
