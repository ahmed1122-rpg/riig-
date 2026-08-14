import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const IMAGE_PATTERN = /^[^\s@]+@sha256:[0-9a-f]{64}$/u;

export function validateReleaseCheckout(input) {
  const violations = [];
  if (!SHA_PATTERN.test(input.releaseGitSha)) {
    violations.push("RELEASE_GIT_SHA must be an exact lowercase Git SHA.");
  }
  if (!TAG_PATTERN.test(input.releaseTag)) {
    violations.push("RELEASE_TAG must be an immutable semantic version tag.");
  }
  if (input.releaseTag !== `v${input.packageVersion}`) {
    violations.push("RELEASE_TAG must equal the root package version.");
  }
  if (input.headGitSha !== input.releaseGitSha) {
    violations.push("The checked-out HEAD does not equal RELEASE_GIT_SHA.");
  }
  if (input.tagGitSha !== input.releaseGitSha) {
    violations.push("RELEASE_TAG does not resolve to RELEASE_GIT_SHA.");
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

function verifyImageSignatures(input) {
  const identity =
    `https://github.com/${input.repository}/.github/workflows/` +
    `release-images.yml@refs/tags/${input.releaseTag}`;
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
  const packageVersion = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ).version;
  const input = {
    releaseGitSha: process.env.RELEASE_GIT_SHA?.trim() ?? "",
    releaseTag: process.env.RELEASE_TAG?.trim() ?? "",
    runtimeImageRef: process.env.RUNTIME_IMAGE_REF?.trim() ?? "",
    webImageRef: process.env.WEB_IMAGE_REF?.trim() ?? "",
    repository: process.env.GITHUB_REPOSITORY?.trim() ?? "",
    packageVersion,
    headGitSha: git("rev-parse", "HEAD"),
    tagGitSha: git(
      "rev-list",
      "-n",
      "1",
      `refs/tags/${process.env.RELEASE_TAG?.trim() ?? ""}`,
    ),
    status: git("status", "--porcelain"),
  };
  const violations = validateReleaseCheckout(input);
  if (!input.repository) violations.push("GITHUB_REPOSITORY is required.");
  if (violations.length > 0) throw new Error(violations.join("\n"));
  if (process.argv.includes("--verify-images")) verifyImageSignatures(input);
  process.stdout.write(
    `Release checkout verified at ${input.releaseGitSha} (${input.releaseTag}).\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
