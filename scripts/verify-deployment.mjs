import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { verifyObservabilityArtifacts } from "./verify-observability-artifacts.mjs";
import { requiredDeploymentFiles } from "./deployment-required-files.mjs";
import { verifyNodeToolchain } from "./verify-node-toolchain.mjs";
import { verifyNginxDeployment, verifyNginxRuntimeWiring } from "./verify-nginx-deployment.mjs";
import { verifyProductionEnvironmentTemplate } from "./verify-production-environment-template.mjs";
import { verifyQaImageContract } from "./verify-qa-image-contract.mjs";
import { verifyRuntimeImageContract } from "./verify-runtime-image-contract.mjs";
import { verifyWorkflowSecurity } from "./verify-workflow-security.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const violations = [];
const nodeVersion = (await readFile(join(root, ".node-version"), "utf8")).trim();

for (const file of requiredDeploymentFiles) {
  try {
    await access(join(root, file));
  } catch {
    violations.push(`Missing deployment artifact: ${file}`);
  }
}

const [
  runtimeDockerfile,
  qaDockerfile,
  webDockerfile,
  compose,
  nginx,
  securityHeaders,
  gitignore,
  dockerignore,
  exampleEnvironment,
  webApiClient,
  processingRuntime,
  processingJobExecutor,
  processingJobClaim,
  processingWorkerConfig,
  mediaWorkerEntry,
  documentWorkerEntry,
  exportWorkerEntry,
  exportWorkerConfig,
  characterWorkerEntry,
  characterWorkerConfig,
  objectStorageEnvironment,
  s3Storage,
  objectStorageContract,
  objectStorageSmoke,
  packageManifest,
  npmConfig,
  localCompose,
  apiPackageManifest,
  deploymentContract,
  securityPolicy,
  incidentResponseRunbook,
  productionComposeRunner,
] =
  await Promise.all(
    [
      "Dockerfile",
      "Dockerfile.qa",
      "Dockerfile.web",
      "compose.production.yaml",
      "deploy/nginx.conf",
      "deploy/security-headers.conf",
      ".gitignore",
      ".dockerignore",
      ".env.production.example",
      "apps/web/src/lib/api/transport.ts",
      "apps/api/src/processing/processing-worker-runtime.ts",
      "apps/api/src/processing/processing-job-executor.ts",
      "apps/api/src/processing/processing-job-claim.ts",
      "apps/api/src/processing/processing-worker-config.ts",
      "apps/worker-media/src/index.ts",
      "apps/worker-document/src/index.ts",
      "apps/worker-export/src/index.ts",
      "apps/worker-export/src/config.ts",
      "apps/worker-character/src/index.ts",
      "apps/worker-character/src/config.ts",
      "apps/api/src/storage/object-storage-environment.ts",
      "apps/api/src/storage/s3-object-storage.ts",
      "docs/OBJECT_STORAGE.md",
      "scripts/verify-object-storage.mjs",
      "package.json",
      ".npmrc",
      "compose.yaml",
      "apps/api/package.json",
      "docs/DEPLOYMENT.md",
      "SECURITY.md",
      "docs/runbooks/incident-response.md",
      "scripts/run-production-compose.mjs",
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
    ".github/workflows/release-rollback-drill.yml",
    ".github/workflows/dependency-audit.yml",
  ].map((file) => readFile(join(root, file), "utf8")),
);
violations.push(...(await verifyObservabilityArtifacts(root)));
violations.push(...verifyWorkflowSecurity(workflowSources));
violations.push(...verifyProductionEnvironmentTemplate(exampleEnvironment));
const ciWorkflow = workflowSources[0];
violations.push(...verifyQaImageContract({ dockerfile: qaDockerfile, ciWorkflow, dockerignore }));
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
requireWorkflowTokens(providerWorkflow, "Provider-readiness identity", [
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
]);
const stagingWorkflow = workflowSources[4];
requireWorkflowTokens(stagingWorkflow, "Staging-readiness", [
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
]);
const performanceWorkflow = workflowSources[5];
requireWorkflowTokens(performanceWorkflow, "Performance-readiness", [
  'LOAD_MIN_CONCURRENCY: "4"', 'LOAD_MIN_TOTAL_JOURNEYS: "12"',
  "LOAD_MAX_API_RSS_GROWTH_BYTES", "LOAD_MAX_WORKER_RSS_GROWTH_BYTES",
  "LOAD_MAX_QUEUE_AGE_SECONDS", 'LOAD_MAX_FINAL_QUEUE_DEPTH: "0"',
  'LOAD_REQUIRE_METRICS: "true"',
  'LOAD_REQUIRE_RELEASE_IDENTITY: "true"',
  "LOAD_RELEASE_GIT_SHA: ${{ vars.RELEASE_GIT_SHA }}",
  "LOAD_EXPECTED_APPLICATION_VERSION: ${{ vars.EXPECTED_APPLICATION_VERSION }}",
  "Verify deployed release identity before the load run",
  ".tmp/performance-release-evidence.json",
]);
const stagingApplicationWorkflow = workflowSources[6];
requireWorkflowTokens(stagingApplicationWorkflow, "Staging-application", [
  "npm run verify:staging-application",
  'LOAD_REQUIRE_RELEASE_IDENTITY: "true"',
  "LOAD_RELEASE_GIT_SHA: ${{ vars.RELEASE_GIT_SHA }}",
  "LOAD_EXPECTED_APPLICATION_VERSION: ${{ vars.EXPECTED_APPLICATION_VERSION }}",
  "LOAD_RUNTIME_IMAGE_REF: ${{ vars.RUNTIME_IMAGE_REF }}",
  "LOAD_WEB_IMAGE_REF: ${{ vars.WEB_IMAGE_REF }}",
]);
const rollbackWorkflow = workflowSources[7];
requireWorkflowTokens(rollbackWorkflow, "Release rollback", [
  "environment: production-readiness",
  "ROLLBACK_RUNTIME_IMAGE_REF",
  "ROLLBACK_WEB_IMAGE_REF",
  "Install Cosign",
  "npm run test:release-rollback",
  "release-rollback-evidence-${{ github.sha }}",
  ".tmp/release-rollback-evidence.json",
  ".tmp/release-drill-rollback-pdf.json",
]);

if (!runtimeDockerfile.includes("USER node")) {
  violations.push("Runtime API image must run as the non-root node user.");
}
if (!runtimeDockerfile.includes("rm -rf /usr/local/lib/node_modules/npm")) {
  violations.push("Runtime API image must remove npm build tooling.");
}
if (
  !runtimeDockerfile.includes(
    "npm prune --omit=dev --ignore-scripts --no-audit --no-fund",
  )
) {
  violations.push("Runtime dependency pruning must not execute lifecycle scripts.");
}
if (
  !runtimeDockerfile.includes(
    "COPY package.json package-lock.json tsconfig.node.json .npmrc ./",
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
violations.push(
  ...verifyRuntimeImageContract({
    dockerfile: runtimeDockerfile,
    composeDocument,
  }),
);
for (const service of [
  "migrate",
  "maintenance",
  "maintenance-scheduler",
  "api",
  "worker-media",
  "worker-document",
  "worker-export",
  "worker-character",
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
for (const token of [
  "validateProductionEnvironment",
  'spawnSync("docker"',
  'new Set(["config", "pull", "up", "ps", "run"])',
]) {
  if (!productionComposeRunner.includes(token)) {
    violations.push(`Production Compose runner is missing safety token: ${token}`);
  }
}
for (const token of ["no-new-privileges:true", "cap_drop:", "read_only: true"]) {
  if (!compose.includes(token)) {
    violations.push(`Production containers are missing hardening token: ${token}`);
  }
}
violations.push(...verifyNginxDeployment(nginx, securityHeaders));
violations.push(
  ...verifyNginxRuntimeWiring({ compose, ciWorkflow, releaseWorkflow }),
);
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
violations.push(
  ...verifyNodeToolchain({
    nodeVersion,
    packageManifest,
    npmConfig,
    dockerfiles: [runtimeDockerfile, webDockerfile],
    qaDockerfiles: [qaDockerfile],
  }),
);
if (!webApiClient.includes("location.origin")) {
  violations.push("Production web builds must default to the same-origin API.");
}
if (!s3Storage.includes('ChecksumAlgorithm: "SHA256"')) {
  violations.push("S3 writes must request a SHA-256 provider checksum.");
}
if (!s3Storage.includes("HeadObjectCommand")) {
  violations.push("S3 writes must verify the configured encryption mode.");
}
const processingRuntimeSources =
  `${processingRuntime}\n${processingJobExecutor}\n${processingJobClaim}`;
if (!processingRuntimeSources.includes("hasExpectedObjectIntegrity")) {
  violations.push("Processing workers must verify stored source integrity.");
}
if (!exportWorkerEntry.includes("loadExportWorkerConfig")) {
  violations.push("Export worker must use its validated storage configuration.");
}
if (
  !characterWorkerEntry.includes("@motionprep/api/character-worker") ||
  !characterWorkerEntry.includes("loadCharacterWorkerConfig")
) {
  violations.push("Character worker must use its validated shared runtime.");
}
for (const [name, runtime] of [
  ["processing", `${processingWorkerConfig}\n${objectStorageEnvironment}`],
  ["export", `${exportWorkerConfig}\n${objectStorageEnvironment}`],
  ["character", `${characterWorkerConfig}\n${objectStorageEnvironment}`],
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
if (!packageManifest.includes('"verify:incident"')) {
  violations.push("Package scripts must expose the incident evidence verifier.");
}
if (!apiPackageManifest.includes('"verify:staging-dependencies"')) {
  violations.push("API package scripts must expose the staging dependency probe.");
}
for (const token of [
  "SEV1",
  "Incident commander",
  "PAYMENT_MODE=disabled",
  "digest-qualified",
  "MotionPrepUploadIntegrityFailure",
  "disaster-recovery.md",
  "npm run verify:incident",
  "Ed25519",
  "Post-incident review",
]) {
  if (!incidentResponseRunbook.includes(token)) {
    violations.push(`Incident response runbook is missing contract token: ${token}`);
  }
}
for (const [name, source] of [
  ["deployment", deploymentContract],
  ["security", securityPolicy],
]) {
  if (!source.includes("incident-response.md")) {
    violations.push(`${name} documentation must link the incident response runbook.`);
  }
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
  if (!processingRuntimeSources.includes(token)) {
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

if (violations.length > 0) {
  console.error("Deployment readiness violations:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log("Deployment artifacts verified.");
}

function requireWorkflowTokens(source, label, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) violations.push(`${label} workflow is missing token: ${token}`);
  }
}
