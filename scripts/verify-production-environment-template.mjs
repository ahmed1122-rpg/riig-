const requiredKeys = [
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "RELEASE_GIT_SHA",
  "TRUSTED_PROXY_CIDR",
  "TRUST_PROXY_HOPS",
  "REDIS_URL",
  "AUTH_ENCRYPTION_KEYRING",
  "AUTH_ENCRYPTION_ACTIVE_KEY_ID",
  "SMTP_PASSWORD",
  "EMAIL_VERIFICATION_REQUIRED",
  "EMAIL_VERIFICATION_URL",
  "OBJECT_STORAGE_SECRET_KEY",
  "OBJECT_STORAGE_SESSION_TOKEN",
  "OBJECT_STORAGE_ENCRYPTION_MODE",
  "MALWARE_SCAN_MODE",
  "MALWARE_SCANNER_HOST",
  "MALWARE_SCANNER_PORT",
  "MALWARE_DEFINITIONS_MAX_AGE_HOURS",
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
  "MOTIONPREP_MIGRATION_ENV_FILE",
  "MOTIONPREP_API_ENV_FILE",
  "MOTIONPREP_MAINTENANCE_ENV_FILE",
  "MOTIONPREP_MEDIA_WORKER_ENV_FILE",
  "MOTIONPREP_DOCUMENT_WORKER_ENV_FILE",
  "MOTIONPREP_EXPORT_WORKER_ENV_FILE",
  "MOTIONPREP_SECURITY_WORKER_ENV_FILE",
  "MOTIONPREP_CHARACTER_WORKER_ENV_FILE",
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
  if (!/^MALWARE_SCAN_MODE=required$/mu.test(source)) {
    violations.push(
      "Production uploads must keep fail-closed malware scanning required.",
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

export function verifyWorkerEnvironmentParity(templates) {
  const violations = [];
  const commonKeys = [
    "NODE_ENV",
    "MOTIONPREP_WORKLOAD_IDENTITY",
    "DATABASE_URL",
    "DATABASE_POOL_MAX",
    "OBJECT_STORAGE_REGION",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ACCESS_KEY",
    "OBJECT_STORAGE_SECRET_KEY",
    "OBJECT_STORAGE_SESSION_TOKEN",
    "OBJECT_STORAGE_FORCE_PATH_STYLE",
    "OBJECT_STORAGE_ENCRYPTION_MODE",
    "OBJECT_STORAGE_REQUIRE_VERSIONING",
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    "OTEL_EXPORTER_OTLP_HEADERS",
    "OTEL_TRACES_SAMPLER",
    "OTEL_TRACES_SAMPLER_ARG",
  ];
  for (const [name, source] of Object.entries(templates)) {
    const keys = new Set(
      source.split(/\r?\n/u)
        .map((line) => /^([A-Z][A-Z0-9_]*)=/u.exec(line)?.[1])
        .filter(Boolean),
    );
    for (const key of commonKeys) {
      if (!keys.has(key)) {
        violations.push(`${name} worker template is missing common key ${key}.`);
      }
    }
  }
  return violations;
}
