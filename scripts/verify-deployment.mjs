import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { verifyDockerHardening } from "./verify-docker-hardening.mjs";
import { verifyObservabilityArtifacts } from "./verify-observability-artifacts.mjs";
import { requiredDeploymentFiles } from "./deployment-required-files.mjs";
import { verifyNodeToolchain } from "./verify-node-toolchain.mjs";
import { verifyNginxDeployment, verifyNginxRuntimeWiring } from "./verify-nginx-deployment.mjs";
import {
  verifyProductionEnvironmentTemplate,
  verifyWorkerEnvironmentParity,
} from "./verify-production-environment-template.mjs";
import { verifyQaImageContract } from "./verify-qa-image-contract.mjs";
import { verifyReadinessWorkflowContracts } from "./verify-readiness-workflows.mjs";
import { verifyRuntimeImageContract } from "./verify-runtime-image-contract.mjs";
import { verifyWorkflowSecurity } from "./verify-workflow-security.mjs";
import { verifyWorkerDeploymentContracts } from "./verify-worker-deployment-contracts.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const violations = [];
const nodeVersion = (await readFile(join(root, ".node-version"), "utf8")).trim();
const integrationCompose = await readFile(
  join(root, "compose.integration.yaml"),
  "utf8",
);
if (!integrationCompose.includes("WORKER_HEALTH_INSTANCE_FILE: /tmp/motionprep-worker-instance-id")) {
  violations.push("Integration workers must publish the per-instance health identity file.");
}

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
  apiExampleEnvironment,
  migrationExampleEnvironment,
  maintenanceExampleEnvironment,
  workerExampleEnvironment,
  characterWorkerExampleEnvironment,
  securityWorkerExampleEnvironment,
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
  securityWorkerEntry,
  securityWorkerConfig,
  securityWorkerRuntime,
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
      ".env.production.api.example",
      ".env.production.migrate.example",
      ".env.production.maintenance.example",
      ".env.production.worker.example",
      ".env.production.worker-character.example",
      ".env.production.worker-security.example",
      "apps/web/src/lib/api/transport.ts",
      "apps/api/src/processing/processing-worker-runtime.ts",
      "apps/api/src/processing/processing-job-executor.ts",
      "apps/api/src/infrastructure/postgres/postgres-processing-job-claim.ts",
      "apps/api/src/processing/processing-worker-config.ts",
      "apps/worker-media/src/index.ts",
      "apps/worker-document/src/index.ts",
      "apps/worker-export/src/index.ts",
      "apps/worker-export/src/config.ts",
      "apps/worker-character/src/index.ts",
      "apps/worker-character/src/config.ts",
      "apps/worker-security/src/index.ts",
      "apps/api/src/security/malware-scan-worker-config.ts",
      "apps/api/src/security/malware-scan-worker-runtime.ts",
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
    ".github/workflows/promote-release.yml",
  ].map((file) => readFile(join(root, file), "utf8")),
);
violations.push(...(await verifyObservabilityArtifacts(root)));
violations.push(...verifyWorkflowSecurity(workflowSources));
violations.push(
  ...verifyProductionEnvironmentTemplate([
    exampleEnvironment,
    apiExampleEnvironment,
    migrationExampleEnvironment,
    maintenanceExampleEnvironment,
    workerExampleEnvironment,
    characterWorkerExampleEnvironment,
    securityWorkerExampleEnvironment,
  ].join("\n")),
);
violations.push(...verifyWorkerEnvironmentParity({
  standard: workerExampleEnvironment,
  character: characterWorkerExampleEnvironment,
  security: securityWorkerExampleEnvironment,
}));
const ciWorkflow = workflowSources[0];
violations.push(
  ...verifyDockerHardening({
    runtimeDockerfile,
    webDockerfile,
    qaDockerfile,
    dockerignore,
    localCompose,
    integrationCompose,
  }),
);
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
violations.push(...verifyReadinessWorkflowContracts(workflowSources));

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
  "worker-security",
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
  'new Set(["config", "pull", "up", "ps", "run", "stop"])',
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
for (const token of [
  "MOTIONPREP_CLAMAV_SOCKET_DIR:?",
  "target: /run/clamav",
  "create_host_path: false",
  "read_only: true",
]) {
  if (!compose.includes(token)) {
    violations.push(`Production ClamAV socket topology is missing token: ${token}`);
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
violations.push(...verifyWorkerDeploymentContracts({
  processingRuntime,
  processingJobExecutor,
  processingJobClaim,
  processingWorkerConfig,
  exportWorkerEntry,
  exportWorkerConfig,
  characterWorkerEntry,
  characterWorkerConfig,
  securityWorkerEntry,
  securityWorkerConfig,
  securityWorkerRuntime,
  mediaWorkerEntry,
  documentWorkerEntry,
  objectStorageEnvironment,
  objectStorageContract,
  objectStorageSmoke,
  packageManifest,
  apiPackageManifest,
  incidentResponseRunbook,
  deploymentContract,
  securityPolicy,
  nginx,
}));

if (violations.length > 0) {
  console.error("Deployment readiness violations:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log("Deployment artifacts verified.");
}
