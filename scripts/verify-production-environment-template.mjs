const requiredKeys = [
  "DATABASE_URL",
  "RELEASE_GIT_SHA",
  "TRUSTED_PROXY_CIDR",
  "TRUST_PROXY_HOPS",
  "REDIS_URL",
  "AUTH_ENCRYPTION_KEY",
  "SMTP_PASSWORD",
  "OBJECT_STORAGE_SECRET_KEY",
  "OBJECT_STORAGE_SESSION_TOKEN",
  "OBJECT_STORAGE_ENCRYPTION_MODE",
  "OBJECT_STORAGE_REQUIRE_VERSIONING",
  "PAYMENT_MODE",
  "PDF_OCR_MODE",
  "EXPORT_EXECUTION_MODE",
  "PROCESSING_LEASE_MS",
  "EXPORT_LEASE_MS",
  "CHARACTER_RIG_ENABLED",
  "CHARACTER_INFERENCE_URL",
  "CHARACTER_INFERENCE_API_KEY",
  "CHARACTER_LEASE_MS",
  "WORKER_EVENT_RETENTION_DAYS",
  "RUNTIME_IMAGE_REF",
  "WEB_IMAGE_REF",
];

export function verifyProductionEnvironmentTemplate(source) {
  const violations = [];
  if (source.includes("E2E_ADMIN_EMAIL")) {
    violations.push(
      "The production environment template cannot expose the test-only E2E administrator seed.",
    );
  }
  if (!/^PDF_REGION_OCR_ENABLED=false$/mu.test(source)) {
    violations.push(
      "Regional PDF OCR must remain disabled in the production template until the holdout gate passes.",
    );
  }
  if (!/^CHARACTER_RIG_ENABLED=false$/mu.test(source)) {
    violations.push(
      "Character Studio must remain disabled in the production template until its private-provider and Golden gates pass.",
    );
  }
  for (const key of requiredKeys) {
    if (!source.includes(`${key}=`)) {
      violations.push(`Production environment template is missing ${key}.`);
    }
  }
  return violations;
}
