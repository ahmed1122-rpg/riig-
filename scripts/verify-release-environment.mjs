import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import {
  assertOpenedHoldoutPolicy,
  computeOcrHoldoutContentDigest,
  computeOcrImplementationDigest,
} from "./ocr-holdout-policy.mjs";

const immutableReference = /^.+@sha256:[a-f0-9]{64}$/u;

export function validateReleaseEnvironment(source) {
  const values = parseEnvironment(source);
  const violations = [];
  for (const key of ["RUNTIME_IMAGE_REF", "WEB_IMAGE_REF"]) {
    const value = values.get(key) ?? "";
    if (!immutableReference.test(value)) {
      violations.push(`${key} must be a registry reference pinned by sha256 digest.`);
    }
  }
  const releaseGitSha = values.get("RELEASE_GIT_SHA") ?? "";
  if (!/^[a-f0-9]{40}$/u.test(releaseGitSha)) {
    violations.push("RELEASE_GIT_SHA must be the exact 40-character release Git SHA.");
  }
  for (const forbidden of ["IMAGE_TAG", "RUNTIME_IMAGE", "WEB_IMAGE"]) {
    if (values.has(forbidden)) {
      violations.push(`${forbidden} is unsupported; use digest-qualified *_IMAGE_REF values.`);
    }
  }
  return violations;
}

export function validateProductionEnvironment(
  source,
  { ocrEvidenceCurrent = false } = {},
) {
  const values = parseEnvironment(source);
  const violations = validateReleaseEnvironment(source);
  const required = [
    "NODE_ENV",
    "RELEASE_GIT_SHA",
    "PERSISTENCE_MODE",
    "DATABASE_URL",
    "REDIS_URL",
    "AUTH_ENCRYPTION_KEY",
    "COOKIE_SECURE",
    "METRICS_BEARER_TOKEN",
    "WEB_ORIGIN",
    "PASSWORD_RESET_URL",
    "EMAIL_DELIVERY_MODE",
    "SMTP_HOST",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM",
    "OBJECT_STORAGE_MODE",
    "OBJECT_STORAGE_REGION",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ENCRYPTION_MODE",
    "OBJECT_STORAGE_REQUIRE_VERSIONING",
    "PROCESSING_EXECUTION_MODE",
    "EXPORT_EXECUTION_MODE",
    "PAYMENT_MODE",
    "PDF_REGION_OCR_ENABLED",
  ];
  for (const key of required) {
    const value = values.get(key)?.trim() ?? "";
    if (!value) violations.push(`${key} is required in the production environment.`);
    else if (/(?:CHANGE_ME|REPLACE_WITH)/iu.test(value)) {
      violations.push(`${key} still contains a template placeholder.`);
    }
  }

  requireExact(values, violations, "NODE_ENV", "production");
  requireExact(values, violations, "PERSISTENCE_MODE", "postgres");
  requireExact(values, violations, "COOKIE_SECURE", "true");
  requireExact(values, violations, "EMAIL_DELIVERY_MODE", "smtp");
  requireExact(values, violations, "OBJECT_STORAGE_MODE", "s3");
  requireExact(values, violations, "OBJECT_STORAGE_REQUIRE_VERSIONING", "true");
  requireExact(values, violations, "PROCESSING_EXECUTION_MODE", "worker");
  requireExact(values, violations, "EXPORT_EXECUTION_MODE", "worker");

  validateUrl(values, violations, "WEB_ORIGIN", ["https:"]);
  validateUrl(values, violations, "PASSWORD_RESET_URL", ["https:"]);
  validateUrl(values, violations, "REDIS_URL", ["rediss:"]);
  validateDatabaseUrl(values, violations);

  const metricsToken = values.get("METRICS_BEARER_TOKEN") ?? "";
  if (metricsToken && metricsToken.length < 32) {
    violations.push("METRICS_BEARER_TOKEN must contain at least 32 characters.");
  }
  const authKey = values.get("AUTH_ENCRYPTION_KEY") ?? "";
  if (authKey && !isThirtyTwoByteBase64(authKey)) {
    violations.push("AUTH_ENCRYPTION_KEY must be Base64 for exactly 32 bytes.");
  }
  if (
    values.get("SMTP_SECURE") !== "true" &&
    values.get("SMTP_REQUIRE_TLS") !== "true"
  ) {
    violations.push("SMTP must use implicit TLS or require STARTTLS.");
  }
  if (values.get("OBJECT_STORAGE_ENCRYPTION_MODE") === "none") {
    violations.push("Production object storage encryption cannot be disabled.");
  }
  const paymentMode = values.get("PAYMENT_MODE");
  if (paymentMode && !["disabled", "live"].includes(paymentMode)) {
    violations.push("PAYMENT_MODE must be disabled or live in production.");
  }
  if (paymentMode === "live") {
    for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) {
      if (!(values.get(key)?.trim())) {
        violations.push(`${key} is required when PAYMENT_MODE=live.`);
      }
    }
  }
  const pdfRegionOcrEnabled = values.get("PDF_REGION_OCR_ENABLED");
  if (
    pdfRegionOcrEnabled &&
    !["true", "false"].includes(pdfRegionOcrEnabled)
  ) {
    violations.push("PDF_REGION_OCR_ENABLED must be true or false.");
  }
  if (pdfRegionOcrEnabled === "true" && !ocrEvidenceCurrent) {
    violations.push(
      "PDF_REGION_OCR_ENABLED cannot be true until the sealed OCR holdout evidence matches the current implementation.",
    );
  }
  return [...new Set(violations)];
}

export async function isOcrReleaseEvidenceCurrent(repositoryRoot) {
  try {
    const manifest = JSON.parse(
      await readFile(
        join(
          repositoryRoot,
          "artifacts/benchmarks/ocr-arabic-corpus/manifest.json",
        ),
        "utf8",
      ),
    );
    const implementationDigest = await computeOcrImplementationDigest(
      repositoryRoot,
    );
    const holdoutContentDigest = computeOcrHoldoutContentDigest(manifest);
    assertOpenedHoldoutPolicy(
      manifest.evaluationPolicy,
      implementationDigest,
      holdoutContentDigest,
    );
    return true;
  } catch {
    return false;
  }
}

function parseEnvironment(source) {
  const values = new Map();
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return values;
}

function requireExact(values, violations, key, expected) {
  const value = values.get(key);
  if (value && value !== expected) {
    violations.push(`${key} must be ${expected}.`);
  }
}

function validateUrl(values, violations, key, protocols) {
  const value = values.get(key);
  if (!value) return;
  try {
    const url = new URL(value);
    if (!protocols.includes(url.protocol)) {
      violations.push(`${key} must use ${protocols.join(" or ")}.`);
    }
  } catch {
    violations.push(`${key} must be a valid URL.`);
  }
}

function validateDatabaseUrl(values, violations) {
  const value = values.get("DATABASE_URL");
  if (!value) return;
  try {
    const url = new URL(value);
    if (!["postgresql:", "postgres:"].includes(url.protocol)) {
      violations.push("DATABASE_URL must use postgresql: or postgres:.");
    }
    if (!["require", "verify-ca", "verify-full"].includes(
      url.searchParams.get("sslmode")?.toLowerCase() ?? "",
    )) {
      violations.push("DATABASE_URL must explicitly require TLS.");
    }
  } catch {
    violations.push("DATABASE_URL must be a valid URL.");
  }
}

function isThirtyTwoByteBase64(value) {
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.byteLength === 32 && decoded.toString("base64") === value;
  } catch {
    return false;
  }
}

async function main() {
  const filename = process.argv[2];
  if (!filename) {
    throw new Error(
      "Usage: node scripts/verify-release-environment.mjs <production.env> [--references-only]",
    );
  }
  const source = await readFile(filename, "utf8");
  const referencesOnly = process.argv.includes("--references-only");
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const ocrEvidenceCurrent = referencesOnly
    ? false
    : await isOcrReleaseEvidenceCurrent(repositoryRoot);
  const violations = referencesOnly
    ? validateReleaseEnvironment(source)
    : validateProductionEnvironment(source, { ocrEvidenceCurrent });
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      referencesOnly
        ? "Immutable release references verified.\n"
        : "Complete production environment verified.\n",
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
