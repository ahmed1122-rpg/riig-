import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createRollbackEvidence,
  loadReleaseDescriptor,
  signatureIdentity,
  validateDrillInputs,
  validateSignatureEvidenceUri,
} from "./release-drill-config.mjs";

function releaseSource(character, gitCharacter) {
  return [
    `RUNTIME_IMAGE_REF=ghcr.io/example/runtime@sha256:${character.repeat(64)}`,
    `WEB_IMAGE_REF=ghcr.io/example/web@sha256:${gitCharacter.repeat(64)}`,
    `RELEASE_GIT_SHA=${gitCharacter.repeat(40)}`,
  ].join("\n");
}

test("loads immutable release coordinates and constructs the exact tag identity", async () => {
  const filename = join(tmpdir(), `motionprep-release-${crypto.randomUUID()}.env`);
  await writeFile(filename, releaseSource("a", "b"), "utf8");
  const release = await loadReleaseDescriptor(filename, "v1.2.3-rc.1");
  assert.equal(release.gitSha, "b".repeat(40));
  assert.equal(
    signatureIdentity("example/repository", release.releaseTag),
    "https://github.com/example/repository/.github/workflows/release-images.yml@refs/tags/v1.2.3-rc.1",
  );
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
