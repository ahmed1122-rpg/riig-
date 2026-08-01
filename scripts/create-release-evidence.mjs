import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const immutableReference = /^.+@sha256:[a-f0-9]{64}$/u;
const gitSha = /^[a-f0-9]{40}$/u;

export function createReleaseEvidence(environment, generatedAt = new Date()) {
  const required = [
    "GITHUB_REPOSITORY",
    "GITHUB_SHA",
    "GITHUB_REF",
    "GITHUB_RUN_ID",
    "RUNTIME_IMAGE_REF",
    "WEB_IMAGE_REF",
  ];
  for (const key of required) {
    if (!environment[key]?.trim()) throw new Error(`${key} is required.`);
  }
  if (!gitSha.test(environment.GITHUB_SHA)) {
    throw new Error("GITHUB_SHA must contain exactly 40 lowercase hex characters.");
  }
  for (const key of ["RUNTIME_IMAGE_REF", "WEB_IMAGE_REF"]) {
    if (!immutableReference.test(environment[key])) {
      throw new Error(`${key} must be pinned by sha256 digest.`);
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    source: {
      repository: environment.GITHUB_REPOSITORY,
      gitSha: environment.GITHUB_SHA,
      gitRef: environment.GITHUB_REF,
      workflowRunId: environment.GITHUB_RUN_ID,
    },
    images: {
      runtime: environment.RUNTIME_IMAGE_REF,
      web: environment.WEB_IMAGE_REF,
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
      "container-hardening",
      "trivy-high-critical",
      "sbom-provenance",
      "repository-bound-cosign",
    ],
    externalGates: {
      stagingManagedDependencies: "pending",
      stagingDeploymentSmoke: "pending",
      rollbackDrill: "pending",
      signedRecoveryDrill: "pending",
      representativeLoadMemory: "pending",
      licensedAdobeGolden: "pending",
    },
  };
}

async function main() {
  const filename = process.argv[2] ?? "release-evidence.json";
  const evidence = createReleaseEvidence(process.env);
  await writeFile(filename, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`Release evidence written to ${filename}.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
