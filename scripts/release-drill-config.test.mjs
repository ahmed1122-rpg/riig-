import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createRollbackEvidence,
  loadReleaseDescriptor,
  reviewFlowForDrillStage,
  signatureIdentity,
  validateDrillInputs,
  validateSignatureEvidenceUri,
} from "./release-drill-config.mjs";

async function createTemporaryReleaseFile(testContext, filename) {
  const directory = await mkdtemp(join(tmpdir(), "motionprep-release-test-"));
  testContext.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, filename);
}

function releaseSource(
  character,
  gitCharacter,
  signatureWorkflow,
  signatureIdentityRef = "refs/heads/main",
) {
  return [
    `RUNTIME_IMAGE_REF=ghcr.io/example/runtime@sha256:${character.repeat(64)}`,
    `WEB_IMAGE_REF=ghcr.io/example/web@sha256:${gitCharacter.repeat(64)}`,
    `RELEASE_GIT_SHA=${gitCharacter.repeat(40)}`,
    `RELEASE_SIGNATURE_WORKFLOW=${signatureWorkflow}`,
    `RELEASE_SIGNATURE_IDENTITY_REF=${signatureIdentityRef}`,
  ].join("\n");
}

test("loads immutable stable coordinates and constructs the promotion identity", async (testContext) => {
  const filename = await createTemporaryReleaseFile(testContext, "stable.env");
  await writeFile(
    filename,
    releaseSource("a", "b", "promote-release.yml"),
    "utf8",
  );
  const release = await loadReleaseDescriptor(filename, "v1.2.3-rc.1");
  assert.equal(release.gitSha, "b".repeat(40));
  assert.equal(release.signatureWorkflow, "promote-release.yml");
  assert.equal(
    signatureIdentity(
      "example/repository",
      release.signatureWorkflow,
      release.signatureIdentityRef,
    ),
    "https://github.com/example/repository/.github/workflows/promote-release.yml@refs/heads/main",
  );
});

test("loads and constrains the protected candidate signature identity", async (testContext) => {
  const filename = await createTemporaryReleaseFile(testContext, "candidate.env");
  await writeFile(
    filename,
    releaseSource("a", "b", "release-images.yml"),
    "utf8",
  );
  const release = await loadReleaseDescriptor(filename, "v1.2.3");
  assert.equal(release.signatureWorkflow, "release-images.yml");
  assert.equal(release.signatureIdentityRef, "refs/heads/main");
  assert.equal(
    signatureIdentity(
      "example/repository",
      release.signatureWorkflow,
      release.signatureIdentityRef,
    ),
    "https://github.com/example/repository/.github/workflows/release-images.yml@refs/heads/main",
  );
  assert.throws(
    () =>
      signatureIdentity(
        "example/repository",
        "release-images.yml",
        "refs/heads/feature",
      ),
    /invalid release metadata/u,
  );
});

test("rejects missing, mixed, and tag-based signature descriptors", async (testContext) => {
  const directory = await mkdtemp(join(tmpdir(), "motionprep-release-test-"));
  testContext.after(() => rm(directory, { recursive: true, force: true }));
  for (const [workflow, identityRef] of [
    ["", ""],
    ["promote-release.yml", "refs/tags/v1.2.3"],
    ["release-images.yml", "refs/tags/v1.2.3"],
    ["unknown.yml", "refs/heads/main"],
  ]) {
    const filename = join(directory, `invalid-${crypto.randomUUID()}.env`);
    const source = [
      releaseSource("a", "b", workflow, identityRef),
    ].join("\n");
    await writeFile(filename, source, "utf8");
    await assert.rejects(
      loadReleaseDescriptor(filename, "v1.2.3"),
      /approved candidate or stable pair/u,
    );
  }
});

test("rejects a no-op rollback", () => {
  const release = {
    gitSha: "a".repeat(40),
    runtimeImage: `runtime@sha256:${"b".repeat(64)}`,
    webImage: `web@sha256:${"c".repeat(64)}`,
  };
  assert.throws(
    () => validateDrillInputs(release, release, "example/repository"),
    /must differ/u,
  );
});

test("records that rollback retains additive migrations", () => {
  const evidence = createRollbackEvidence({
    repository: "example/repository",
    candidate: { gitSha: "a".repeat(40) },
    rollback: { gitSha: "b".repeat(40) },
    startedAt: new Date("2026-08-02T00:00:00.000Z"),
    completedAt: new Date("2026-08-02T00:01:00.000Z"),
    outcome: "passed",
    checks: { rollbackPdfJourney: "passed" },
  });
  assert.equal(evidence.durationMs, 60_000);
  assert.equal(evidence.migrationPolicy.rollbackMigrationsRun, false);
  assert.equal(evidence.outcome, "passed");
});

test("uses the review flow implemented by each drilled release", () => {
  assert.equal(reviewFlowForDrillStage("candidate"), "approval-required");
  assert.equal(reviewFlowForDrillStage("rollback"), "pre-approval");
  assert.throws(() => reviewFlowForDrillStage("unknown"), /drill stage/u);
});

test("accepts only an explicit GitHub Actions run as external signature evidence", () => {
  assert.equal(
    validateSignatureEvidenceUri(
      "https://github.com/example/repository/actions/runs/123456",
    ),
    "https://github.com/example/repository/actions/runs/123456",
  );
  assert.throws(
    () => validateSignatureEvidenceUri("https://example.com/signatures/passed"),
    /GitHub Actions run URL/u,
  );
});
