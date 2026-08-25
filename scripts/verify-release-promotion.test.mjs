import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadReleaseDescriptor,
  signatureIdentity,
} from "./release-drill-config.mjs";
import {
  createPromotionEvidence,
  createStableReleaseEnvironment,
  validateReleasePromotion,
} from "./verify-release-promotion.mjs";

const expected = {
  releaseTag: "v0.1.9",
  packageVersion: "0.1.9",
  gitSha: "a".repeat(40),
  runtimeImageRef: `runtime@sha256:${"b".repeat(64)}`,
  webImageRef: `web@sha256:${"c".repeat(64)}`,
  signatureWorkflow: "release-images.yml",
  signatureIdentityRef: "refs/heads/main",
};
const coordinates = {
  gitSha: expected.gitSha,
  runtimeImageRef: expected.runtimeImageRef,
  webImageRef: expected.webImageRef,
  signatureWorkflow: expected.signatureWorkflow,
  signatureIdentityRef: expected.signatureIdentityRef,
};
const appEvidence = {
  releaseGitSha: expected.gitSha,
  imageReferences: {
    runtime: expected.runtimeImageRef,
    web: expected.webImageRef,
  },
  checks: { releaseIdentity: "passed" },
};
const loadEvidence = {
  release: { expected: { ...coordinates } },
  outcome: { passed: true, checks: { releaseIdentity: true } },
};
const objectStorage = {
  verified: true,
  releaseGitSha: expected.gitSha,
  checks: ["readiness", "write", "integrity", "read", "delete"],
};
const rollbackChecks = Object.fromEntries(
  [
    "candidateSignatures", "rollbackSignatures", "candidateImages",
    "rollbackImages", "candidateReadiness", "candidateWebHealth",
    "candidateWorkerIdentity", "candidatePdfJourney",
    "applicationOnlyRollback", "rollbackReadiness", "rollbackWebHealth",
    "rollbackWorkerIdentity", "rollbackPdfJourney",
  ].map((name) => [name, "passed"]),
);
const valid = {
  expected,
  candidateEnv: coordinates,
  stagingEnv: coordinates,
  providerEnv: { ...coordinates, characterRigEnabled: "false" },
  candidateEvidence: {
    releaseStage: "candidate",
    source: { gitSha: expected.gitSha },
    images: { runtime: expected.runtimeImageRef, web: expected.webImageRef },
    signingIdentity: {
      workflow: expected.signatureWorkflow,
      identityRef: expected.signatureIdentityRef,
    },
    securityRiskAcceptances: { trivyUnfixedHighCritical: { count: 0 } },
  },
  currentTrivyExceptionCount: 0,
  stagingDependencies: {
    verified: true,
    releaseGitSha: expected.gitSha,
    dependencies: ["PostgreSQL", "Redis", "SMTP"].map((name) => ({
      name,
      tls: "verified",
    })),
  },
  stagingObjectStorage: objectStorage,
  stagingApplication: appEvidence,
  stagingLoad: loadEvidence,
  performanceApplication: appEvidence,
  performanceLoad: loadEvidence,
  providerObjectStorage: objectStorage,
  characterProvider: {
    schemaVersion: 1,
    enabled: false,
    verified: false,
    status: "disabled",
    releaseGitSha: expected.gitSha,
    checks: ["feature-disabled"],
  },
  recovery: {
    manifestDigest: `sha256:${"d".repeat(64)}`,
    release: coordinates,
    checks: { ed25519Signature: "passed", integrity: "passed" },
  },
  rollback: {
    outcome: "passed",
    candidate: {
      gitSha: expected.gitSha,
      runtimeImage: expected.runtimeImageRef,
      webImage: expected.webImageRef,
    },
    checks: rollbackChecks,
  },
  runIds: {
    candidate: "1",
    stagingDependencies: "2",
    stagingApplication: "3",
    performance: "4",
    provider: "5",
    rollback: "6",
  },
};

test("accepts complete exact-digest promotion evidence", () => {
  assert.deepEqual(validateReleasePromotion(valid), []);
  const evidence = createPromotionEvidence(
    {
      repository: "example/repository",
      promotionWorkflowRunId: "7",
      expected,
      runIds: valid.runIds,
    },
    new Date("2026-08-20T12:00:00.000Z"),
  );
  assert.equal(evidence.releaseStage, "stable-promotion-ready");
  assert.equal(evidence.release.runtimeImageRef, expected.runtimeImageRef);
  assert.deepEqual(evidence.stableSigningIdentity, {
    workflow: "promote-release.yml",
    identityRef: "refs/heads/main",
  });
});

test("emits a rollback-verifiable stable descriptor for the promotion identity", async (testContext) => {
  const directory = await mkdtemp(join(tmpdir(), "motionprep-promotion-test-"));
  testContext.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, "stable.env");
  await writeFile(filename, createStableReleaseEnvironment(expected), "utf8");
  const descriptor = await loadReleaseDescriptor(filename, expected.releaseTag);
  assert.equal(descriptor.signatureWorkflow, "promote-release.yml");
  assert.equal(descriptor.signatureIdentityRef, "refs/heads/main");
  assert.equal(
    signatureIdentity(
      "example/repository",
      descriptor.signatureWorkflow,
      descriptor.signatureIdentityRef,
    ),
    "https://github.com/example/repository/.github/workflows/promote-release.yml@refs/heads/main",
  );
});

test("rejects candidate workflow identity drift in every descriptor", () => {
  const violations = validateReleasePromotion({
    ...valid,
    stagingEnv: {
      ...coordinates,
      signatureWorkflow: "promote-release.yml",
    },
  });
  assert.match(violations.join("\n"), /staging dependencies coordinates/u);

  const evidenceViolations = validateReleasePromotion({
    ...valid,
    candidateEvidence: {
      ...valid.candidateEvidence,
      signingIdentity: {
        workflow: "promote-release.yml",
        identityRef: "refs/heads/main",
      },
    },
  });
  assert.match(evidenceViolations.join("\n"), /Signed candidate evidence/u);
});

test("rejects coordinate drift and incomplete external evidence", () => {
  const violations = validateReleasePromotion({
    ...valid,
    stagingApplication: {
      ...appEvidence,
      releaseGitSha: "f".repeat(40),
    },
    rollback: { ...valid.rollback, outcome: "failed" },
    recovery: { ...valid.recovery, manifestDigest: "missing" },
  });
  assert.match(violations.join("\n"), /staging application/u);
  assert.match(violations.join("\n"), /Rollback evidence/u);
  assert.match(violations.join("\n"), /recovery verification/u);
});

test("blocks stable promotion while any High or Critical exception remains", () => {
  const violations = validateReleasePromotion({
    ...valid,
    currentTrivyExceptionCount: 1,
  });
  assert.match(violations.join("\n"), /zero unfixed High\/Critical/u);
});

test("requires verified async GPU evidence when Character Rig is enabled", () => {
  const violations = validateReleasePromotion({
    ...valid,
    providerEnv: { ...coordinates, characterRigEnabled: "true" },
  });
  assert.match(violations.join("\n"), /Enabled Character provider gate/u);

  const checks = [
    "https",
    "capabilities",
    "scale-to-zero-policy",
    "async-submission",
    "same-origin-status-polling",
    "terminal-success",
  ];
  assert.deepEqual(
    validateReleasePromotion({
      ...valid,
      providerEnv: { ...coordinates, characterRigEnabled: "true" },
      characterProvider: {
        schemaVersion: 1,
        enabled: true,
        verified: true,
        status: "verified",
        releaseGitSha: expected.gitSha,
        protocol: "async-v1",
        checks,
      },
    }),
    [],
  );
});
