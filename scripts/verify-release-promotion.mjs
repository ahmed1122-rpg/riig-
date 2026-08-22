import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyReleaseGateEvidence } from "./package-release-gate-evidence.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const shaPattern = /^[a-f0-9]{40}$/u;
const digestPattern = /^.+@sha256:[a-f0-9]{64}$/u;
const candidateSignature = {
  workflow: "release-images.yml",
  identityRef: "refs/heads/main",
};
const stableSignature = {
  workflow: "promote-release.yml",
  identityRef: "refs/heads/main",
};

export function validateReleasePromotion(input) {
  const violations = [];
  const expected = input.expected;
  if (!shaPattern.test(expected.gitSha)) {
    violations.push("Promotion requires an exact lowercase Git SHA.");
  }
  if (expected.releaseTag !== `v${expected.packageVersion}`) {
    violations.push("Promotion tag must equal the root package version.");
  }
  for (const [label, value] of [
    ["runtime", expected.runtimeImageRef],
    ["web", expected.webImageRef],
  ]) {
    if (!digestPattern.test(value)) {
      violations.push(`Promotion ${label} image must be digest-qualified.`);
    }
  }
  if (
    expected.signatureWorkflow !== candidateSignature.workflow ||
    expected.signatureIdentityRef !== candidateSignature.identityRef
  ) {
    violations.push(
      "Candidate signature identity must be release-images.yml@refs/heads/main.",
    );
  }

  requireCoordinates(violations, "candidate manifest", input.candidateEnv, expected);
  requireCoordinates(violations, "staging dependencies", input.stagingEnv, expected);
  requireCoordinates(violations, "provider readiness", input.providerEnv, expected);

  const candidate = input.candidateEvidence;
  if (
    candidate?.releaseStage !== "candidate" ||
    candidate?.source?.gitSha !== expected.gitSha ||
    candidate?.images?.runtime !== expected.runtimeImageRef ||
    candidate?.images?.web !== expected.webImageRef ||
    candidate?.signingIdentity?.workflow !== expected.signatureWorkflow ||
    candidate?.signingIdentity?.identityRef !== expected.signatureIdentityRef
  ) {
    violations.push("Signed candidate evidence does not match promotion coordinates.");
  }
  if (
    candidate?.securityRiskAcceptances?.trivyUnfixedHighCritical?.count !== 0 ||
    input.currentTrivyExceptionCount !== 0
  ) {
    violations.push(
      "Stable promotion requires zero unfixed High/Critical Trivy risk acceptances.",
    );
  }

  requireDependencyEvidence(
    violations,
    "staging dependency",
    input.stagingDependencies,
    expected,
  );
  requireObjectStorageEvidence(
    violations,
    "staging object storage",
    input.stagingObjectStorage,
    expected,
  );
  requireApplicationEvidence(
    violations,
    "staging application",
    input.stagingApplication,
    expected,
  );
  requireLoadEvidence(
    violations,
    "staging PDF journey",
    input.stagingLoad,
    expected,
  );
  requireApplicationEvidence(
    violations,
    "performance release identity",
    input.performanceApplication,
    expected,
  );
  requireLoadEvidence(
    violations,
    "representative performance load",
    input.performanceLoad,
    expected,
  );
  requireObjectStorageEvidence(
    violations,
    "provider object storage",
    input.providerObjectStorage,
    expected,
  );
  requireRecoveryEvidence(violations, input.recovery, expected);
  requireRollbackEvidence(violations, input.rollback, expected);

  for (const [name, runId] of Object.entries(input.runIds ?? {})) {
    if (!/^\d+$/u.test(String(runId))) {
      violations.push(`${name} must identify a successful GitHub Actions run.`);
    }
  }
  return [...new Set(violations)];
}

export function createPromotionEvidence(input, generatedAt = new Date()) {
  return {
    schemaVersion: 1,
    releaseStage: "stable-promotion-ready",
    generatedAt: generatedAt.toISOString(),
    repository: input.repository,
    promotionWorkflowRunId: input.promotionWorkflowRunId,
    release: input.expected,
    verifiedRuns: input.runIds,
    stableSigningIdentity: stableSignature,
    gates: {
      signedCandidate: "passed",
      zeroHighCriticalRiskAcceptances: "passed",
      managedDependencies: "passed",
      stagingApplication: "passed",
      representativeLoad: "passed",
      providerAndRecovery: "passed",
      applicationRollback: "passed",
      legalApproval: "verified-separately-before-promotion",
    },
  };
}

export function createStableReleaseEnvironment(expected) {
  return [
    `RELEASE_TAG=${expected.releaseTag}`,
    `RELEASE_GIT_SHA=${expected.gitSha}`,
    `RUNTIME_IMAGE_REF=${expected.runtimeImageRef}`,
    `WEB_IMAGE_REF=${expected.webImageRef}`,
    `RELEASE_SIGNATURE_WORKFLOW=${stableSignature.workflow}`,
    `RELEASE_SIGNATURE_IDENTITY_REF=${stableSignature.identityRef}`,
    "",
  ].join("\n");
}

function requireCoordinates(violations, label, actual, expected) {
  if (
    actual?.gitSha !== expected.gitSha ||
    actual?.runtimeImageRef !== expected.runtimeImageRef ||
    actual?.webImageRef !== expected.webImageRef ||
    actual?.signatureWorkflow !== expected.signatureWorkflow ||
    actual?.signatureIdentityRef !== expected.signatureIdentityRef
  ) {
    violations.push(`${label} coordinates do not match the candidate.`);
  }
}

function requireDependencyEvidence(violations, label, evidence, expected) {
  const dependencies = new Map(
    (evidence?.dependencies ?? []).map((entry) => [entry.name, entry.tls]),
  );
  if (
    evidence?.verified !== true ||
    evidence?.releaseGitSha !== expected.gitSha ||
    ["PostgreSQL", "Redis", "SMTP"].some(
      (name) => dependencies.get(name) !== "verified",
    )
  ) {
    violations.push(`${label} evidence is incomplete or belongs to another SHA.`);
  }
}

function requireObjectStorageEvidence(violations, label, evidence, expected) {
  const checks = new Set(evidence?.checks ?? []);
  if (
    evidence?.verified !== true ||
    evidence?.releaseGitSha !== expected.gitSha ||
    ["readiness", "write", "integrity", "read", "delete"].some(
      (check) => !checks.has(check),
    )
  ) {
    violations.push(`${label} evidence is incomplete or belongs to another SHA.`);
  }
}

function requireApplicationEvidence(violations, label, evidence, expected) {
  if (
    evidence?.releaseGitSha !== expected.gitSha ||
    evidence?.imageReferences?.runtime !== expected.runtimeImageRef ||
    evidence?.imageReferences?.web !== expected.webImageRef ||
    Object.values(evidence?.checks ?? {}).some((value) => value !== "passed") ||
    Object.keys(evidence?.checks ?? {}).length === 0
  ) {
    violations.push(`${label} evidence is incomplete or has coordinate drift.`);
  }
}

function requireLoadEvidence(violations, label, evidence, expected) {
  const release = evidence?.release?.expected;
  if (
    evidence?.outcome?.passed !== true ||
    evidence?.outcome?.checks?.releaseIdentity !== true ||
    release?.gitSha !== expected.gitSha ||
    release?.runtimeImageRef !== expected.runtimeImageRef ||
    release?.webImageRef !== expected.webImageRef
  ) {
    violations.push(`${label} did not pass against the exact candidate.`);
  }
}

function requireRecoveryEvidence(violations, evidence, expected) {
  if (
    evidence?.release?.gitSha !== expected.gitSha ||
    evidence?.release?.runtimeImageRef !== expected.runtimeImageRef ||
    evidence?.release?.webImageRef !== expected.webImageRef ||
    Object.values(evidence?.checks ?? {}).some((value) => value !== "passed") ||
    Object.keys(evidence?.checks ?? {}).length === 0 ||
    !/^sha256:[a-f0-9]{64}$/u.test(evidence?.manifestDigest ?? "")
  ) {
    violations.push("Signed recovery verification is incomplete or has coordinate drift.");
  }
}

function requireRollbackEvidence(violations, evidence, expected) {
  const requiredChecks = [
    "candidateSignatures",
    "rollbackSignatures",
    "candidateImages",
    "rollbackImages",
    "candidateReadiness",
    "candidateWebHealth",
    "candidateWorkerIdentity",
    "candidatePdfJourney",
    "applicationOnlyRollback",
    "rollbackReadiness",
    "rollbackWebHealth",
    "rollbackWorkerIdentity",
    "rollbackPdfJourney",
  ];
  if (
    evidence?.outcome !== "passed" ||
    evidence?.candidate?.gitSha !== expected.gitSha ||
    evidence?.candidate?.runtimeImage !== expected.runtimeImageRef ||
    evidence?.candidate?.webImage !== expected.webImageRef ||
    requiredChecks.some(
      (name) => !String(evidence?.checks?.[name] ?? "").startsWith("passed"),
    )
  ) {
    violations.push("Rollback evidence is incomplete or has candidate drift.");
  }
}

function parseEnvironment(source) {
  const values = new Map();
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator > 0) values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return {
    gitSha: values.get("RELEASE_GIT_SHA") ?? "",
    runtimeImageRef: values.get("RUNTIME_IMAGE_REF") ?? "",
    webImageRef: values.get("WEB_IMAGE_REF") ?? "",
    signatureWorkflow: values.get("RELEASE_SIGNATURE_WORKFLOW") ?? "",
    signatureIdentityRef: values.get("RELEASE_SIGNATURE_IDENTITY_REF") ?? "",
  };
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

async function main() {
  const inputRoot = process.argv[2] ?? "promotion-inputs";
  const output = process.argv[3] ?? "promotion-evidence.json";
  const packageManifest = await readJson(join(root, "package.json"));
  await Promise.all([
    verifyReleaseGateEvidence(
      join(inputRoot, "candidate", "release-source-evidence"),
      ["topology-pdf-load-report.json", "fault-recovery-report.json"],
    ),
    verifyReleaseGateEvidence(join(inputRoot, "staging-dependencies"), [
      "staging-release.env",
      "staging-dependency-evidence.json",
      "staging-object-storage-evidence.json",
    ]),
    verifyReleaseGateEvidence(join(inputRoot, "staging-application"), [
      "staging-application-evidence.json",
      "staging-smoke-pdf-report.json",
    ]),
    verifyReleaseGateEvidence(join(inputRoot, "performance"), [
      "performance-release-evidence.json",
      "pdf-load-report.json",
    ]),
    verifyReleaseGateEvidence(join(inputRoot, "provider"), [
      "provider-release.env",
      "provider-object-storage-evidence.json",
      "recovery-verification-evidence.json",
    ]),
    verifyReleaseGateEvidence(join(inputRoot, "rollback"), [
      "release-rollback-evidence.json",
      "release-drill-candidate-pdf.json",
      "release-drill-rollback-pdf.json",
    ]),
  ]);
  const candidateEnv = parseEnvironment(
    await readFile(join(inputRoot, "candidate", "release.env"), "utf8"),
  );
  const trivyLedger = await readJson(
    join(root, "security", "trivy-unfixed-exceptions.json"),
  );
  const expected = {
    releaseTag: process.env.RELEASE_TAG?.trim() ?? "",
    packageVersion: packageManifest.version,
    gitSha: process.env.RELEASE_GIT_SHA?.trim() ?? "",
    runtimeImageRef: candidateEnv.runtimeImageRef,
    webImageRef: candidateEnv.webImageRef,
    signatureWorkflow: candidateEnv.signatureWorkflow,
    signatureIdentityRef: candidateEnv.signatureIdentityRef,
  };
  const input = {
    expected,
    candidateEnv,
    candidateEvidence: await readJson(
      join(inputRoot, "candidate", "release-evidence.json"),
    ),
    currentTrivyExceptionCount: trivyLedger.exceptions?.length ?? 0,
    stagingEnv: parseEnvironment(
      await readFile(
        join(inputRoot, "staging-dependencies", "staging-release.env"),
        "utf8",
      ),
    ),
    stagingDependencies: await readJson(
      join(
        inputRoot,
        "staging-dependencies",
        "staging-dependency-evidence.json",
      ),
    ),
    stagingObjectStorage: await readJson(
      join(
        inputRoot,
        "staging-dependencies",
        "staging-object-storage-evidence.json",
      ),
    ),
    stagingApplication: await readJson(
      join(
        inputRoot,
        "staging-application",
        "staging-application-evidence.json",
      ),
    ),
    stagingLoad: await readJson(
      join(
        inputRoot,
        "staging-application",
        "staging-smoke-pdf-report.json",
      ),
    ),
    performanceApplication: await readJson(
      join(
        inputRoot,
        "performance",
        "performance-release-evidence.json",
      ),
    ),
    performanceLoad: await readJson(
      join(inputRoot, "performance", "pdf-load-report.json"),
    ),
    providerEnv: parseEnvironment(
      await readFile(
        join(inputRoot, "provider", "provider-release.env"),
        "utf8",
      ),
    ),
    providerObjectStorage: await readJson(
      join(
        inputRoot,
        "provider",
        "provider-object-storage-evidence.json",
      ),
    ),
    recovery: await readJson(
      join(
        inputRoot,
        "provider",
        "recovery-verification-evidence.json",
      ),
    ),
    rollback: await readJson(
      join(
        inputRoot,
        "rollback",
        "release-rollback-evidence.json",
      ),
    ),
    runIds: {
      candidate: process.env.CANDIDATE_RUN_ID,
      stagingDependencies: process.env.STAGING_DEPENDENCIES_RUN_ID,
      stagingApplication: process.env.STAGING_APPLICATION_RUN_ID,
      performance: process.env.PERFORMANCE_RUN_ID,
      provider: process.env.PROVIDER_RUN_ID,
      rollback: process.env.ROLLBACK_RUN_ID,
    },
  };
  const violations = validateReleasePromotion(input);
  if (violations.length > 0) {
    throw new Error(`Stable promotion evidence failed:\n- ${violations.join("\n- ")}`);
  }
  const evidence = createPromotionEvidence({
    repository: process.env.GITHUB_REPOSITORY,
    promotionWorkflowRunId: process.env.GITHUB_RUN_ID,
    expected,
    runIds: input.runIds,
  });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await mkdir("stable-release", { recursive: true });
  await writeFile(
    join("stable-release", "release.env"),
    createStableReleaseEnvironment(expected),
    "utf8",
  );
  process.stdout.write(`Stable promotion evidence written to ${output}.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
