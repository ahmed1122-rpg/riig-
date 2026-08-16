export function verifyWorkerDeploymentContracts(input) {
  const violations = [];
  const processingRuntimeSources =
    `${input.processingRuntime}\n${input.processingJobExecutor}\n${input.processingJobClaim}`;
  if (!processingRuntimeSources.includes("hasExpectedObjectIntegrity")) {
    violations.push("Processing workers must verify stored source integrity.");
  }
  if (!input.exportWorkerEntry.includes("loadExportWorkerConfig")) {
    violations.push("Export worker must use its validated storage configuration.");
  }
  if (
    !input.characterWorkerEntry.includes("@motionprep/api/character-worker") ||
    !input.characterWorkerEntry.includes("loadCharacterWorkerConfig")
  ) {
    violations.push("Character worker must use its validated shared runtime.");
  }
  for (const [name, runtime] of [
    ["processing", `${input.processingWorkerConfig}\n${input.objectStorageEnvironment}`],
    ["export", `${input.exportWorkerConfig}\n${input.objectStorageEnvironment}`],
    ["character", `${input.characterWorkerConfig}\n${input.objectStorageEnvironment}`],
  ]) {
    if (!runtime.includes("OBJECT_STORAGE_SESSION_TOKEN")) {
      violations.push(`${name} worker must support temporary S3 credentials.`);
    }
  }
  for (const token of ["sources/", "derived/", "artifacts/", "24 hours"]) {
    if (!input.objectStorageContract.includes(token)) {
      violations.push(`Object-storage contract is missing retention token: ${token}`);
    }
  }
  for (const token of [
    "hasExpectedObjectIntegrity",
    "storage.ready(false)",
    "await storage.delete(key)",
    "requireVersioning",
  ]) {
    if (!input.objectStorageSmoke.includes(token)) {
      violations.push(`Provider storage probe is missing verification token: ${token}`);
    }
  }
  if (!input.packageManifest.includes('"verify:object-storage"')) {
    violations.push("Package scripts must expose the provider object-storage probe.");
  }
  if (!input.packageManifest.includes('"verify:incident"')) {
    violations.push("Package scripts must expose the incident evidence verifier.");
  }
  if (!input.apiPackageManifest.includes('"verify:staging-dependencies"')) {
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
    if (!input.incidentResponseRunbook.includes(token)) {
      violations.push(`Incident response runbook is missing contract token: ${token}`);
    }
  }
  for (const [name, source] of [
    ["deployment", input.deploymentContract],
    ["security", input.securityPolicy],
  ]) {
    if (!source.includes("incident-response.md")) {
      violations.push(`${name} documentation must link the incident response runbook.`);
    }
  }
  if (input.nginx.includes("location /internal")) {
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
    ["media", input.mediaWorkerEntry],
    ["document", input.documentWorkerEntry],
  ]) {
    if (!entry.includes("@motionprep/api/processing-worker")) {
      violations.push(`${name} worker must use the shared processing runtime.`);
    }
    if (entry.includes("@aws-sdk") || entry.includes('from "pg"')) {
      violations.push(`${name} worker entry duplicates runtime infrastructure.`);
    }
  }
  return violations;
}
