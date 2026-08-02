import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { verifyObservabilityArtifacts } from "./verify-observability-artifacts.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const requiredFiles = [
  "Dockerfile",
  "Dockerfile.web",
  "compose.production.yaml",
  "compose.yaml",
  "compose.integration.yaml",
  ".gitignore",
  ".env.production.example",
  "deploy/nginx.conf",
  "deploy/prometheus-alerts.yml",
  "deploy/prometheus-alerts.test.yml",
  "deploy/prometheus-scrape.example.yml",
  "deploy/grafana/dashboards/motionprep-overview.json",
  "docs/DEPLOYMENT.md",
  "docs/OBJECT_STORAGE.md",
  "docs/PRODUCTION_READINESS.md",
  "scripts/verify-object-storage.mjs",
  "apps/api/scripts/verify-staging-dependencies.mjs",
  "apps/api/scripts/verify-staging-dependencies.node-test.mjs",
  "docs/runbooks/production-release-and-rollback.md",
  "docs/runbooks/processing-job-recovery.md",
  "docs/runbooks/production-dependency-recovery.md",
  "docs/runbooks/disaster-recovery.md",
  "docs/runbooks/failure-mode-matrix.md",
  "docs/runbooks/recovery-manifest.example.json",
  "scripts/verify-recovery-manifest.mjs",
  "scripts/verify-production-topology.mjs",
  "scripts/verify-runtime-fault-recovery.mjs",
  "scripts/load-pdf-workflow.mjs",
  "scripts/load-pdf-config.mjs",
  "scripts/load-test-metrics.mjs",
  "scripts/verify-prometheus-rules.mjs",
  "scripts/verify-staging-application.mjs",
  "scripts/verify-bundle-budget.mjs",
  "scripts/verify-release-environment.mjs",
  "apps/api/migrations/012_processing_worker_leases.sql",
  "apps/api/migrations/016_retention_cleanup.sql",
  "apps/api/migrations/018_worker_events.sql",
  "apps/api/migrations/019_upload_url_compatibility.sql",
  "apps/api/migrations/020_worker_duration_metrics.sql",
  "apps/api/migrations/023_project_job_fencing.sql",
  "apps/api/migrations/024_billing_webhook_ordering.sql",
  "apps/api/migrations/025_retention_reference_indexes.sql",
  "apps/api/migrations/026_maintenance_status.sql",
  "apps/api/migrations/028_job_correlation.sql",
  "apps/api/migrations/030_worker_resource_metrics.sql",
  ".github/workflows/ci.yml",
  ".github/workflows/release-images.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/provider-readiness.yml",
  ".github/workflows/staging-readiness.yml",
  ".github/workflows/performance-readiness.yml",
  ".github/workflows/staging-application-readiness.yml",
  ".github/dependabot.yml",
  ".github/CODEOWNERS",
];
const violations = [];

for (const file of requiredFiles) {
  try {
    await access(join(root, file));
  } catch {
    violations.push(`Missing deployment artifact: ${file}`);
  }
}

const [
  runtimeDockerfile,
  webDockerfile,
  compose,
  nginx,
  gitignore,
  exampleEnvironment,
  webApiClient,
  processingRuntime,
  processingWorkerConfig,
  mediaWorkerEntry,
  documentWorkerEntry,
  exportWorkerEntry,
  exportWorkerConfig,
  objectStorageEnvironment,
  s3Storage,
  objectStorageContract,
  objectStorageSmoke,
  packageManifest,
  localCompose,
  apiPackageManifest,
] =
  await Promise.all(
    [
      "Dockerfile",
      "Dockerfile.web",
      "compose.production.yaml",
      "deploy/nginx.conf",
      ".gitignore",
      ".env.production.example",
      "apps/web/src/lib/api/transport.ts",
      "apps/api/src/processing/processing-worker-runtime.ts",
      "apps/api/src/processing/processing-worker-config.ts",
      "apps/worker-media/src/index.ts",
      "apps/worker-document/src/index.ts",
      "apps/worker-export/src/index.ts",
      "apps/worker-export/src/config.ts",
      "apps/api/src/storage/object-storage-environment.ts",
      "apps/api/src/storage/s3-object-storage.ts",
      "docs/OBJECT_STORAGE.md",
      "scripts/verify-object-storage.mjs",
      "package.json",
      "compose.yaml",
      "apps/api/package.json",
    ].map((file) => readFile(join(root, file), "utf8")),
  );

const workflowSources = await Promise.all(
  [
    ".github/workflows/ci.yml",
    ".github/workflows/release-images.yml",
    ".github/workflows/codeql.yml",
    ".github/workflows/provider-readiness.yml",
    ".github/workflows/staging-readiness.yml",
    ".github/workflows/performance-readiness.yml",
    ".github/workflows/staging-application-readiness.yml",
  ].map((file) => readFile(join(root, file), "utf8")),
);
violations.push(...(await verifyObservabilityArtifacts(root)));
for (const [index, workflow] of workflowSources.entries()) {
  try {
    parse(workflow);
  } catch (error) {
    violations.push(
      `Workflow ${index + 1} is invalid YAML: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  for (const match of workflow.matchAll(/uses:\s+([^@\s]+)@([^\s#]+)/gu)) {
    const [, action, reference] = match;
    if (!/^[a-f0-9]{40}$/u.test(reference ?? "")) {
      violations.push(
        `GitHub Action ${action ?? "unknown"} is not pinned by commit SHA: ${reference ?? "missing"}`,
      );
    }
  }
}
const ciWorkflow = workflowSources[0];
try {
  const ciDocument = parse(ciWorkflow);
  const containerSteps =
    ciDocument?.jobs?.["container-build"]?.steps?.map(
      (step) => step.name,
    ) ?? [];
  const fixtureSteps =
    ciDocument?.jobs?.["release-fixtures"]?.steps?.map(
      (step) => step.name,
    ) ?? [];
  if (!containerSteps.includes("Scan web image")) {
    violations.push(
      "The web image scan must run in the job that builds the web image.",
    );
  }
  if (fixtureSteps.includes("Scan web image")) {
    violations.push(
      "The fixture job cannot scan an image built on another runner.",
    );
  }
  if (!ciWorkflow.includes("--add-host api:127.0.0.1")) {
    violations.push(
      "The CI hardened web smoke must provide the API hostname expected by nginx.",
    );
  }
  if (!ciWorkflow.includes("npm run verify:alerts")) {
    violations.push("CI container build must exercise Prometheus alert rules.");
  }
  if (
    !ciWorkflow.includes(
      "npm run verify:staging-dependencies:test --workspace @motionprep/api",
    )
  ) {
    violations.push(
      "CI validate must run the staging dependency verifier tests.",
    );
  }
} catch {
  // The workflow parse violation above already reports the syntax failure.
}
for (const imageName of ["postgres", "minio/minio"]) {
  const localImage = localCompose
    .split(/\r?\n/u)
    .find((line) => line.includes(`image: ${imageName}`))
    ?.trim()
    .replace(/^image:\s*/u, "");
  if (!localImage?.includes("@sha256:") || !ciWorkflow.includes(localImage)) {
    violations.push(
      `CI ${imageName} service must reuse the exact digest-pinned local dependency image.`,
    );
  }
}
const releaseWorkflow = workflowSources[1];
for (const token of [
  "verify-source:",
  "needs: verify-source",
  "environment: production-release",
  "npm run quality",
  "npm run verify:alerts",
  "npm run test:topology:full",
  "release-source-evidence-${{ github.sha }}",
  "release-source-evidence/fault-recovery-report.json",
  "release-source-evidence/topology-pdf-load-report.json",
  "cosign sign --yes",
  "Verify repository-bound signatures",
  "--certificate-identity \"${identity}\"",
  "RUNTIME_IMAGE_REF",
  "WEB_IMAGE_REF",
  "@${{ steps.runtime.outputs.digest }}",
  "sbom: true",
  "provenance: mode=max",
  "--add-host api:127.0.0.1",
]) {
  if (!releaseWorkflow.includes(token)) {
    violations.push(`Release workflow is missing immutable supply-chain token: ${token}`);
  }
}
if (
  releaseWorkflow.indexOf("publish:") <
  releaseWorkflow.indexOf("verify-source:")
) {
  violations.push(
    "Release image publishing must remain downstream of the source verification job.",
  );
}
if (
  releaseWorkflow.indexOf("Sign approved immutable image digests") <
  releaseWorkflow.indexOf("Scan published web digest")
) {
  violations.push(
    "Release image signing must occur only after both vulnerability scans pass.",
  );
}
const providerWorkflow = workflowSources[3];
for (const token of [
  "Reject ambiguous or missing provider credentials",
  "AWS_ROLE_ARN",
  "AWS_REGION",
  "Configure short-lived AWS credentials through GitHub OIDC",
  "aws-actions/configure-aws-credentials@",
  "role-to-assume: ${{ vars.AWS_ROLE_ARN }}",
  "Choose AWS OIDC or explicit S3 credentials, not both.",
  "RECOVERY_MANIFEST_JSON: ${{ secrets.RECOVERY_MANIFEST_JSON }}",
  "RECOVERY_SIGNING_PUBLIC_KEY_PEM",
  "--public-key recovery-public-key.pem",
  "provider-readiness-evidence-${{ github.sha }}",
  ".tmp/provider-object-storage-evidence.json",
]) {
  if (!providerWorkflow.includes(token)) {
    violations.push(
      `Provider-readiness workflow is missing identity token: ${token}`,
    );
  }
}
const stagingWorkflow = workflowSources[4];
for (const token of [
  "environment: production-readiness",
  "DATABASE_URL: ${{ secrets.DATABASE_URL }}",
  "REDIS_URL: ${{ secrets.REDIS_URL }}",
  "SMTP_PASSWORD: ${{ secrets.SMTP_PASSWORD }}",
  "Configure short-lived AWS credentials through GitHub OIDC",
  "npm run verify:staging-dependencies --workspace @motionprep/api",
  "npm run verify:object-storage",
  "Recovery evidence: intentionally remains in the production provider gate",
  "staging-dependency-evidence-${{ github.sha }}",
  ".tmp/staging-dependency-evidence.json",
  ".tmp/staging-object-storage-evidence.json",
]) {
  if (!stagingWorkflow.includes(token)) {
    violations.push(`Staging-readiness workflow is missing token: ${token}`);
  }
}
const performanceWorkflow = workflowSources[5];
for (const token of [
  'LOAD_MIN_CONCURRENCY: "4"', 'LOAD_MIN_TOTAL_JOURNEYS: "12"',
  "LOAD_MAX_API_RSS_GROWTH_BYTES", "LOAD_MAX_WORKER_RSS_GROWTH_BYTES",
  "LOAD_MAX_QUEUE_AGE_SECONDS", 'LOAD_MAX_FINAL_QUEUE_DEPTH: "0"',
  'LOAD_REQUIRE_METRICS: "true"',
]) {
  if (!performanceWorkflow.includes(token)) {
    violations.push(`Performance-readiness workflow is missing token: ${token}`);
  }
}

if (!runtimeDockerfile.includes("USER node")) {
  violations.push("Runtime API image must run as the non-root node user.");
}
if (!runtimeDockerfile.includes("rm -rf /usr/local/lib/node_modules/npm")) {
  violations.push("Runtime API image must remove npm build tooling.");
}
if (
  !runtimeDockerfile.includes(
    "COPY package.json package-lock.json tsconfig.node.json ./",
  )
) {
  violations.push(
    "Runtime image must copy the shared TypeScript configuration before building workspaces.",
  );
}
if (!packageManifest.includes('"test:topology:full"')) {
  violations.push(
    "Root package must expose a self-contained production topology lifecycle command.",
  );
}
if (!webDockerfile.includes("USER nginx")) {
  violations.push("Runtime web image must run as the non-root nginx user.");
}
let composeDocument;
try {
  composeDocument = parse(compose);
} catch (error) {
  violations.push(
    `Production compose is invalid YAML: ${error instanceof Error ? error.message : "unknown error"}`,
  );
}
for (const service of [
  "migrate",
  "maintenance",
  "maintenance-scheduler",
  "api",
  "worker-media",
  "worker-document",
  "worker-export",
  "web",
]) {
  if (!composeDocument?.services?.[service]) {
    violations.push(`Production compose is missing service ${service}.`);
  }
}
if (!compose.includes("service_completed_successfully")) {
  violations.push("API/workers must wait for a successful database migration.");
}
if (!compose.includes("run-retention-cleanup.js")) {
  violations.push("Production compose must expose the retention maintenance task.");
}
if (!compose.includes("run-retention-scheduler.js")) {
  violations.push("Production compose must run scheduled retention maintenance.");
}
for (const imageVariable of ["RUNTIME_IMAGE_REF", "WEB_IMAGE_REF"]) {
  if (!compose.includes(`${imageVariable}:?`)) {
    violations.push(
      `Production compose must require the immutable ${imageVariable}.`,
    );
  }
}
if (compose.includes("IMAGE_TAG") || /^\s+build:/mu.test(compose)) {
  violations.push(
    "Production compose must consume prebuilt digest references and must not build or deploy tags.",
  );
}
for (const token of ["no-new-privileges:true", "cap_drop:", "read_only: true"]) {
  if (!compose.includes(token)) {
    violations.push(`Production containers are missing hardening token: ${token}`);
  }
}
if (!nginx.includes("client_max_body_size 30m")) {
  violations.push("Nginx upload limit must match the 30 MiB application limit.");
}
if (!nginx.includes("proxy_pass http://api:4000")) {
  violations.push("Nginx must proxy the versioned API to the API service.");
}
if (!nginx.includes("proxy_set_header X-Forwarded-For $remote_addr;")) {
  violations.push("Nginx must replace untrusted forwarded-IP chains.");
}
for (const token of [
  ".env.*",
  "!.env.example",
  "!.env.*.example",
]) {
  if (!gitignore.includes(token)) {
    violations.push(`Git ignore policy is missing environment rule: ${token}`);
  }
}
for (const image of ["postgres", "redis", "minio/minio", "minio/mc", "axllent/mailpit"]) {
  const imageLine = localCompose
    .split(/\r?\n/u)
    .find((line) => line.includes(`image: ${image}`));
  if (!imageLine?.includes("@sha256:")) {
    violations.push(`Local ${image} image must be pinned by digest.`);
  }
}
for (const dockerfile of [runtimeDockerfile, webDockerfile]) {
  for (const line of dockerfile.split(/\r?\n/u)) {
    if (/^FROM /u.test(line) && !line.includes("@sha256:")) {
      violations.push(`Dockerfile base image must be pinned by digest: ${line}`);
    }
  }
}
if (!webApiClient.includes("location.origin")) {
  violations.push("Production web builds must default to the same-origin API.");
}
if (!s3Storage.includes('ChecksumAlgorithm: "SHA256"')) {
  violations.push("S3 writes must request a SHA-256 provider checksum.");
}
if (!s3Storage.includes("HeadObjectCommand")) {
  violations.push("S3 writes must verify the configured encryption mode.");
}
if (!processingRuntime.includes("hasExpectedObjectIntegrity")) {
  violations.push("Processing workers must verify stored source integrity.");
}
if (!exportWorkerEntry.includes("loadExportWorkerConfig")) {
  violations.push("Export worker must use its validated storage configuration.");
}
for (const [name, runtime] of [
  ["processing", `${processingWorkerConfig}\n${objectStorageEnvironment}`],
  ["export", `${exportWorkerConfig}\n${objectStorageEnvironment}`],
]) {
  if (!runtime.includes("OBJECT_STORAGE_SESSION_TOKEN")) {
    violations.push(`${name} worker must support temporary S3 credentials.`);
  }
}
for (const token of ["sources/", "derived/", "artifacts/", "24 hours"]) {
  if (!objectStorageContract.includes(token)) {
    violations.push(`Object-storage contract is missing retention token: ${token}`);
  }
}
for (const token of [
  "hasExpectedObjectIntegrity",
  "storage.ready(false)",
  "await storage.delete(key)",
  "requireVersioning",
]) {
  if (!objectStorageSmoke.includes(token)) {
    violations.push(`Provider storage probe is missing verification token: ${token}`);
  }
}
if (!packageManifest.includes('"verify:object-storage"')) {
  violations.push("Package scripts must expose the provider object-storage probe.");
}
if (!apiPackageManifest.includes('"verify:staging-dependencies"')) {
  violations.push("API package scripts must expose the staging dependency probe.");
}
if (!/^PDF_REGION_OCR_ENABLED=false$/mu.test(exampleEnvironment)) {
  violations.push(
    "Regional PDF OCR must remain disabled in the production template until the holdout gate passes.",
  );
}
if (nginx.includes("location /internal")) {
  violations.push("Internal metrics must not be exposed by the public web proxy.");
}
for (const token of [
  "FOR UPDATE SKIP LOCKED",
  "lease_expires_at",
  "renewLease",
  "retryOrFail",
]) {
  if (!processingRuntime.includes(token)) {
    violations.push(`Processing worker runtime is missing reliability token: ${token}`);
  }
}
for (const [name, entry] of [
  ["media", mediaWorkerEntry],
  ["document", documentWorkerEntry],
]) {
  if (!entry.includes("@motionprep/api/processing-worker")) {
    violations.push(`${name} worker must use the shared processing runtime.`);
  }
  if (entry.includes("@aws-sdk") || entry.includes('from "pg"')) {
    violations.push(`${name} worker entry duplicates runtime infrastructure.`);
  }
}

for (const key of [
  "DATABASE_URL",
  "RELEASE_GIT_SHA",
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
  "WORKER_EVENT_RETENTION_DAYS",
  "RUNTIME_IMAGE_REF",
  "WEB_IMAGE_REF",
]) {
  if (!exampleEnvironment.includes(`${key}=`)) {
    violations.push(`Production environment template is missing ${key}.`);
  }
}

if (violations.length > 0) {
  console.error("Deployment readiness violations:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log("Deployment artifacts verified.");
}
