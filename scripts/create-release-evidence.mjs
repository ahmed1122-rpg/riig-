import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const immutableReference = /^.+@sha256:[a-f0-9]{64}$/u;
const gitSha = /^[a-f0-9]{40}$/u;

export function createReleaseEvidence(environment, generatedAt = new Date()) {
  const required = [
    "GITHUB_REPOSITORY",
    "GITHUB_REF",
    "GITHUB_RUN_ID",
    "RELEASE_GIT_SHA",
    "RELEASE_SIGNATURE_WORKFLOW",
    "RELEASE_SIGNATURE_IDENTITY_REF",
    "TRIVY_EXCEPTION_COUNT",
    "RUNTIME_IMAGE_REF",
    "WEB_IMAGE_REF",
  ];
  for (const key of required) {
    if (!environment[key]?.trim()) throw new Error(`${key} is required.`);
  }
  if (!gitSha.test(environment.RELEASE_GIT_SHA)) {
    throw new Error("RELEASE_GIT_SHA must contain exactly 40 lowercase hex characters.");
  }
  if (
    environment.GITHUB_SHA &&
    environment.GITHUB_SHA !== environment.RELEASE_GIT_SHA
  ) {
    throw new Error("The workflow SHA must equal RELEASE_GIT_SHA.");
  }
  if (
    environment.RELEASE_SIGNATURE_WORKFLOW !== "release-images.yml" ||
    environment.RELEASE_SIGNATURE_IDENTITY_REF !== "refs/heads/main" ||
    environment.GITHUB_REF !== environment.RELEASE_SIGNATURE_IDENTITY_REF
  ) {
    throw new Error(
      "Candidate evidence must originate from release-images.yml@refs/heads/main.",
    );
  }
  for (const key of ["RUNTIME_IMAGE_REF", "WEB_IMAGE_REF"]) {
    if (!immutableReference.test(environment[key])) {
      throw new Error(`${key} must be pinned by sha256 digest.`);
    }
  }

  const trivyExceptionCount = Number(environment.TRIVY_EXCEPTION_COUNT);
  if (!Number.isSafeInteger(trivyExceptionCount) || trivyExceptionCount < 0) {
    throw new Error("TRIVY_EXCEPTION_COUNT must be a non-negative integer.");
  }

  return {
    schemaVersion: 1,
    releaseStage: "candidate",
    generatedAt: generatedAt.toISOString(),
    source: {
      repository: environment.GITHUB_REPOSITORY,
      gitSha: environment.RELEASE_GIT_SHA,
      gitRef: environment.GITHUB_REF,
      workflowRunId: environment.GITHUB_RUN_ID,
    },
    images: {
      runtime: environment.RUNTIME_IMAGE_REF,
      web: environment.WEB_IMAGE_REF,
    },
    signingIdentity: {
      workflow: environment.RELEASE_SIGNATURE_WORKFLOW,
      identityRef: environment.RELEASE_SIGNATURE_IDENTITY_REF,
    },
    completedGates: [
      "exact-sha-checkout",
      "source-quality",
      "production-dependency-audit",
      "browser-e2e",
      "concurrent-migrations",
      "durable-postgres-s3",
      "production-shaped-topology",
      "dependency-fault-recovery",
      "concurrent-pdf-smoke-load",
      "licensed-adobe-golden",
      "container-hardening",
      "trivy-no-unapproved-high-critical",
      "sbom-provenance",
      "repository-bound-cosign",
    ],
    securityRiskAcceptances: {
      trivyUnfixedHighCritical: {
        count: trivyExceptionCount,
        ledger: "security/trivy-unfixed-exceptions.json",
        stablePromotion:
          trivyExceptionCount === 0 ? "eligible" : "blocked-until-zero",
      },
    },
    externalGates: {
      stagingManagedDependencies: "pending",
      stagingDeploymentSmoke: "pending",
      rollbackDrill: "pending",
      signedRecoveryDrill: "pending",
      representativeLoadMemory: "pending",
    },
  };
}

async function main() {
  const filename = process.argv[2] ?? "release-evidence.json";
  const trivyLedger = JSON.parse(
    await readFile(
      new URL("../security/trivy-unfixed-exceptions.json", import.meta.url),
      "utf8",
    ),
  );
  const evidence = createReleaseEvidence({
    ...process.env,
    TRIVY_EXCEPTION_COUNT: String(trivyLedger.exceptions?.length ?? 0),
  });
  await writeFile(filename, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`Release evidence written to ${filename}.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
