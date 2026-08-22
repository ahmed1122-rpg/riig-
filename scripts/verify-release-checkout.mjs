import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const IMAGE_PATTERN = /^[^\s@]+@sha256:[0-9a-f]{64}$/u;
const CANDIDATE_SIGNATURE = {
  workflow: "release-images.yml",
  identityRef: "refs/heads/main",
};
const STABLE_SIGNATURE = {
  workflow: "promote-release.yml",
  identityRef: "refs/heads/main",
};

export function validateReleaseCheckout(input, { mode = "final" } = {}) {
  const violations = [];
  if (!SHA_PATTERN.test(input.releaseGitSha)) {
    violations.push("RELEASE_GIT_SHA must be an exact lowercase Git SHA.");
  }
  if (mode === "final") {
    if (!TAG_PATTERN.test(input.releaseTag)) {
      violations.push("RELEASE_TAG must be an immutable semantic version tag.");
    }
    if (input.releaseTag !== `v${input.packageVersion}`) {
      violations.push("RELEASE_TAG must equal the root package version.");
    }
    if (input.tagGitSha !== input.releaseGitSha) {
      violations.push("RELEASE_TAG does not resolve to RELEASE_GIT_SHA.");
    }
    requireSignatureIdentity(violations, input, STABLE_SIGNATURE, "Stable");
  } else if (mode === "candidate") {
    requireSignatureIdentity(
      violations,
      input,
      CANDIDATE_SIGNATURE,
      "Candidate",
    );
  } else {
    violations.push("Release checkout mode must be candidate or final.");
  }
  if (input.headGitSha !== input.releaseGitSha) {
    violations.push("The checked-out HEAD does not equal RELEASE_GIT_SHA.");
  }
  if (input.status.trim() !== "") {
    violations.push("The release checkout must be clean before verification.");
  }
  for (const [name, value] of [
    ["RUNTIME_IMAGE_REF", input.runtimeImageRef],
    ["WEB_IMAGE_REF", input.webImageRef],
  ]) {
    if (!IMAGE_PATTERN.test(value)) {
      violations.push(`${name} must be pinned by sha256 digest.`);
    }
  }
  return violations;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function requireSignatureIdentity(violations, input, expected, label) {
  if (
    input.releaseSignatureWorkflow !== expected.workflow ||
    input.releaseSignatureIdentityRef !== expected.identityRef
  ) {
    violations.push(
      `${label} signatures must originate from ${expected.workflow}@${expected.identityRef}.`,
    );
  }
}

function verifyImageSignatures(input) {
  const identity =
    `https://github.com/${input.repository}/.github/workflows/` +
    `${input.releaseSignatureWorkflow}@${input.releaseSignatureIdentityRef}`;
  for (const image of [input.runtimeImageRef, input.webImageRef]) {
    execFileSync(
      process.env.COSIGN_BIN ?? "cosign",
      [
        "verify",
        "--certificate-identity",
        identity,
        "--certificate-oidc-issuer",
        "https://token.actions.githubusercontent.com",
        image,
      ],
      { stdio: "inherit" },
    );
  }
}

function main() {
  const mode = process.argv.includes("--candidate") ? "candidate" : "final";
  const packageVersion = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ).version;
  const input = {
    releaseGitSha: process.env.RELEASE_GIT_SHA?.trim() ?? "",
    releaseTag: process.env.RELEASE_TAG?.trim() ?? "",
    runtimeImageRef: process.env.RUNTIME_IMAGE_REF?.trim() ?? "",
    webImageRef: process.env.WEB_IMAGE_REF?.trim() ?? "",
    repository: process.env.GITHUB_REPOSITORY?.trim() ?? "",
    releaseSignatureWorkflow:
      process.env.RELEASE_SIGNATURE_WORKFLOW?.trim() ?? "",
    releaseSignatureIdentityRef:
      process.env.RELEASE_SIGNATURE_IDENTITY_REF?.trim() ?? "",
    mode,
    packageVersion,
    headGitSha: git("rev-parse", "HEAD"),
    tagGitSha: mode === "final"
      ? git(
          "rev-list",
          "-n",
          "1",
          `refs/tags/${process.env.RELEASE_TAG?.trim() ?? ""}`,
        )
      : "",
    status: git("status", "--porcelain"),
  };
  const violations = validateReleaseCheckout(input, { mode });
  if (!input.repository) violations.push("GITHUB_REPOSITORY is required.");
  if (violations.length > 0) throw new Error(violations.join("\n"));
  if (process.argv.includes("--verify-images")) verifyImageSignatures(input);
  process.stdout.write(
    mode === "candidate"
      ? `Release candidate checkout verified at ${input.releaseGitSha}.\n`
      : `Release checkout verified at ${input.releaseGitSha} (${input.releaseTag}).\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
