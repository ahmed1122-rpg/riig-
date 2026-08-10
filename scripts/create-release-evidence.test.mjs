import assert from "node:assert/strict";
import test from "node:test";
import { createReleaseEvidence } from "./create-release-evidence.mjs";

const environment = {
  GITHUB_REPOSITORY: "example/motionprep",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_REF: "refs/tags/v0.1.1",
  GITHUB_RUN_ID: "12345",
  RUNTIME_IMAGE_REF: `ghcr.io/example/runtime@sha256:${"b".repeat(64)}`,
  WEB_IMAGE_REF: `ghcr.io/example/web@sha256:${"c".repeat(64)}`,
};

test("creates immutable evidence while leaving external gates truthful", () => {
  const evidence = createReleaseEvidence(
    environment,
    new Date("2026-08-01T00:00:00.000Z"),
  );
  assert.equal(evidence.source.gitSha, environment.GITHUB_SHA);
  assert.equal(evidence.images.runtime, environment.RUNTIME_IMAGE_REF);
  assert.equal(evidence.externalGates.rollbackDrill, "pending");
  assert.ok(evidence.completedGates.includes("dependency-fault-recovery"));
  assert.ok(evidence.completedGates.includes("licensed-adobe-golden"));
  assert.equal("licensedAdobeGolden" in evidence.externalGates, false);
});

test("rejects mutable images and abbreviated commits", () => {
  assert.throws(
    () => createReleaseEvidence({ ...environment, RUNTIME_IMAGE_REF: "runtime:latest" }),
    /sha256 digest/u,
  );
  assert.throws(
    () => createReleaseEvidence({ ...environment, GITHUB_SHA: "abc123" }),
    /40 lowercase hex/u,
  );
});
