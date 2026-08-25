import assert from "node:assert/strict";
import test from "node:test";
import { validateReleaseCheckout } from "./verify-release-checkout.mjs";

const valid = {
  releaseGitSha: "a".repeat(40),
  releaseTag: "v0.1.7",
  runtimeImageRef: `ghcr.io/example/runtime@sha256:${"b".repeat(64)}`,
  webImageRef: `ghcr.io/example/web@sha256:${"c".repeat(64)}`,
  packageVersion: "0.1.7",
  headGitSha: "a".repeat(40),
  tagGitSha: "a".repeat(40),
  releaseSignatureWorkflow: "promote-release.yml",
  releaseSignatureIdentityRef: "refs/heads/main",
  status: "",
};

test("accepts a clean exact-SHA checkout and matching immutable tag", () => {
  assert.deepEqual(validateReleaseCheckout(valid), []);
});

test("rejects checkout, tag, version, and dirty-tree drift", () => {
  const violations = validateReleaseCheckout({
    ...valid,
    releaseTag: "v0.1.6",
    headGitSha: "d".repeat(40),
    tagGitSha: "e".repeat(40),
    status: " M package.json",
  });
  assert.equal(violations.length, 4);
});

test("rejects mutable image tags", () => {
  const violations = validateReleaseCheckout({
    ...valid,
    runtimeImageRef: "ghcr.io/example/runtime:latest",
  });
  assert.match(violations.join(" "), /RUNTIME_IMAGE_REF.*sha256/u);
});

test("accepts an untagged candidate signed only from protected main", () => {
  assert.deepEqual(
    validateReleaseCheckout(
      {
        ...valid,
        releaseTag: "",
        tagGitSha: "",
        releaseSignatureWorkflow: "release-images.yml",
        releaseSignatureIdentityRef: "refs/heads/main",
      },
      { mode: "candidate" },
    ),
    [],
  );
});

test("rejects candidate signatures from an arbitrary branch", () => {
  const violations = validateReleaseCheckout(
    {
      ...valid,
      releaseTag: "",
      tagGitSha: "",
      releaseSignatureWorkflow: "release-images.yml",
      releaseSignatureIdentityRef: "refs/heads/feature",
    },
    { mode: "candidate" },
  );
  assert.match(
    violations.join("\n"),
    /release-images\.yml@refs\/heads\/main/u,
  );
});

test("rejects a candidate/stable workflow identity mix-up", () => {
  const candidateViolations = validateReleaseCheckout(
    {
      ...valid,
      releaseTag: "",
      tagGitSha: "",
      releaseSignatureWorkflow: "promote-release.yml",
    },
    { mode: "candidate" },
  );
  assert.match(candidateViolations.join("\n"), /release-images\.yml/u);

  const stableViolations = validateReleaseCheckout({
    ...valid,
    releaseSignatureWorkflow: "release-images.yml",
  });
  assert.match(stableViolations.join("\n"), /promote-release\.yml/u);
});
