import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign,
} from "node:crypto";
import test from "node:test";
import {
  recoveryManifestSigningPayload,
  validateRecoveryManifest,
  validateRecoveryManifestSignature,
} from "./verify-recovery-manifest.mjs";

const validManifest = {
  drillId: "drill-2026-q3",
  incidentDetectedAt: "2026-07-29T00:15:00.000Z",
  recoveryStartedAt: "2026-07-29T00:20:00.000Z",
  databaseRestoreAt: "2026-07-29T00:05:00.000Z",
  objectRestoreAt: "2026-07-29T00:06:00.000Z",
  apiReadyAt: "2026-07-29T01:00:00.000Z",
  smokeCompletedAt: "2026-07-29T01:15:00.000Z",
  databaseBackupId: "pitr-20260729-0005",
  objectSnapshotId: "bucket-version-20260729-0006",
  objectStorageBucket: "motionprep-production",
  encryptionKeyId: "kms-motionprep-production-v3",
  operator: "service-owner",
  targetEnvironment: "isolated-recovery",
  runtimeImageRef: `ghcr.io/example/runtime@sha256:${"a".repeat(64)}`,
  webImageRef: `ghcr.io/example/web@sha256:${"b".repeat(64)}`,
  integrity: {
    missingObjects: 0,
    corruptObjects: 0,
    restoredJourneyPassed: true,
  },
  attestation: {
    algorithm: "Ed25519",
    signer: "production-service-owner",
    signedAt: "2026-07-29T01:20:00.000Z",
    signature:
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
  },
};

test("accepts a coordinated recovery within the RPO and RTO", () => {
  assert.deepEqual(validateRecoveryManifest(validManifest), []);
});

test("rejects stale object recovery and mutable image tags", () => {
  const violations = validateRecoveryManifest({
    ...validManifest,
    objectRestoreAt: "2026-07-28T23:40:00.000Z",
    webImageRef: "ghcr.io/example/web:latest",
  });
  assert.match(violations.join("\n"), /RPO|differ/u);
  assert.match(violations.join("\n"), /digest-qualified/u);
});

test("rejects a missed RTO and integrity failure", () => {
  const violations = validateRecoveryManifest({
    ...validManifest,
    smokeCompletedAt: "2026-07-29T05:00:01.000Z",
    integrity: {
      missingObjects: 1,
      corruptObjects: 0,
      restoredJourneyPassed: false,
    },
  });
  assert.match(violations.join("\n"), /RTO exceeds/u);
  assert.match(violations.join("\n"), /missingObjects/u);
  assert.match(violations.join("\n"), /restoredJourneyPassed/u);
});

test("requires the object-store bucket and attestation metadata", () => {
  const violations = validateRecoveryManifest({
    ...validManifest,
    objectStorageBucket: "",
    attestation: undefined,
  });
  assert.match(violations.join("\n"), /objectStorageBucket/u);
  assert.match(violations.join("\n"), /attestation.algorithm/u);
  assert.match(violations.join("\n"), /attestation.signature/u);
});

test("verifies an Ed25519-attested recovery manifest", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const manifest = {
    ...validManifest,
    attestation: {
      algorithm: "Ed25519",
      signer: "production-service-owner",
      signedAt: "2026-07-29T01:20:00.000Z",
      signature: "",
    },
  };
  manifest.attestation.signature = sign(
    null,
    recoveryManifestSigningPayload(manifest),
    privateKey,
  ).toString("base64");

  assert.deepEqual(
    validateRecoveryManifestSignature(
      manifest,
      publicKey.export({ type: "spki", format: "pem" }),
    ),
    [],
  );
});

test("rejects a tampered or unsigned recovery manifest", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const manifest = {
    ...validManifest,
    attestation: {
      algorithm: "Ed25519",
      signer: "production-service-owner",
      signedAt: "2026-07-29T01:20:00.000Z",
      signature: "",
    },
  };
  manifest.attestation.signature = sign(
    null,
    recoveryManifestSigningPayload(manifest),
    privateKey,
  ).toString("base64");
  const publicKeyPem = publicKey.export({
    type: "spki",
    format: "pem",
  });

  assert.match(
    validateRecoveryManifestSignature(
      { ...manifest, objectSnapshotId: "tampered-snapshot" },
      publicKeyPem,
    ).join("\n"),
    /signature is invalid/u,
  );
  assert.match(
    validateRecoveryManifestSignature(
      { ...manifest, attestation: undefined },
      publicKeyPem,
    ).join("\n"),
    /algorithm|signature/u,
  );
});
