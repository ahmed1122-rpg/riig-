import { readFile } from "node:fs/promises";
import { validateReleaseEnvironment } from "./verify-release-environment.mjs";

const releaseTagPattern = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

export async function loadReleaseDescriptor(filename, releaseTag) {
  const source = await readFile(filename, "utf8");
  const violations = validateReleaseEnvironment(source);
  if (violations.length > 0) {
    throw new Error(`${filename}: ${violations.join(" ")}`);
  }
  if (!releaseTagPattern.test(releaseTag)) {
    throw new Error(`${filename}: release tag is invalid.`);
  }
  const values = parseEnvironment(source);
  return {
    releaseTag,
    gitSha: values.get("RELEASE_GIT_SHA"),
    runtimeImage: values.get("RUNTIME_IMAGE_REF"),
    webImage: values.get("WEB_IMAGE_REF"),
  };
}

export function validateDrillInputs(candidate, rollback, repository) {
  const violations = [];
  if (!repositoryPattern.test(repository)) {
    violations.push("repository must use the owner/name form.");
  }
  if (candidate.gitSha === rollback.gitSha) {
    violations.push("candidate and rollback Git SHAs must differ.");
  }
  if (candidate.runtimeImage === rollback.runtimeImage) {
    violations.push("candidate and rollback runtime digests must differ.");
  }
  if (candidate.webImage === rollback.webImage) {
    violations.push("candidate and rollback web digests must differ.");
  }
  if (violations.length > 0) throw new Error(violations.join(" "));
}

export function signatureIdentity(repository, releaseTag) {
  if (!repositoryPattern.test(repository) || !releaseTagPattern.test(releaseTag)) {
    throw new Error("Cannot construct an identity from invalid release metadata.");
  }
  return `https://github.com/${repository}/.github/workflows/release-images.yml@refs/tags/${releaseTag}`;
}

export function reviewFlowForDrillStage(stage) {
  if (stage === "candidate") return "approval-required";
  if (stage === "rollback") return "pre-approval";
  throw new Error("Release drill stage must be candidate or rollback.");
}

export function validateSignatureEvidenceUri(value) {
  if (!value) return null;
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    !/\/actions\/runs\/\d+\/?$/u.test(url.pathname)
  ) {
    throw new Error(
      "External signature evidence must be an HTTPS GitHub Actions run URL.",
    );
  }
  return url.href;
}

export function createRollbackEvidence({
  repository,
  candidate,
  rollback,
  startedAt,
  completedAt,
  outcome,
  checks,
  signatureEvidence = null,
  failure = null,
}) {
  return {
    schemaVersion: 1,
    repository,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    outcome,
    migrationPolicy: {
      candidateMigrationsApplied: true,
      rollbackMigrationsRun: false,
      strategy: "retain-additive-schema-and-recreate-application-services-only",
    },
    candidate,
    rollback,
    signatureEvidence,
    checks,
    failure,
  };
}

function parseEnvironment(source) {
  const values = new Map();
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator > 0) {
      values.set(line.slice(0, separator), line.slice(separator + 1));
    }
  }
  return values;
}
