import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  incidentManifestSigningPayload,
  validateIncidentManifest,
  validateIncidentManifestSignature,
} from "./verify-incident-manifest.mjs";

const knownAlerts = new Set(["MotionPrepObjectStorageUnavailable"]);
const validManifest = {
  schemaVersion: 1,
  incidentId: "INC-2026-08-04-001",
  severity: "SEV2",
  status: "closed",
  title: "Object storage readiness outage",
  environment: "staging",
  detectionSource: "monitoring",
  detectedAt: "2026-08-04T10:00:00.000Z",
  acknowledgedAt: "2026-08-04T10:08:00.000Z",
  containedAt: "2026-08-04T10:18:00.000Z",
  recoveredAt: "2026-08-04T10:42:00.000Z",
  closedAt: "2026-08-04T11:05:00.000Z",
  roles: {
    incidentCommander: "release-owner",
    technicalLead: "operations-owner",
    communicationsLead: "product-owner",
  },
  affectedServices: ["api", "object_storage"],
  triggeredAlerts: ["MotionPrepObjectStorageUnavailable"],
  release: {
    gitSha: "a".repeat(40),
    runtimeImageRef: `ghcr.io/example/runtime@sha256:${"b".repeat(64)}`,
    webImageRef: `ghcr.io/example/web@sha256:${"c".repeat(64)}`,
  },
  customerImpact: {
    summary: "Staging workflows were unavailable.",
    dataIntegrity: "verified-intact",
    dataExposure: "not-detected",
  },
  securityEscalated: false,
  containmentSummary: "Paused affected workers.",
  recoverySummary: "Restored the private bucket policy.",
  rootCauseSummary: "The workload identity policy was incomplete.",
  actions: [
    {
      at: "2026-08-04T10:08:00.000Z",
      kind: "detection",
      summary: "Confirmed the alert.",
    },
    {
      at: "2026-08-04T10:18:00.000Z",
      kind: "containment",
      summary: "Paused workers.",
    },
    {
      at: "2026-08-04T10:42:00.000Z",
      kind: "recovery",
      summary: "Restored least-privilege access.",
    },
    {
      at: "2026-08-04T10:48:00.000Z",
      kind: "verification",
      summary: "Completed the PDF journey.",
    },
  ],
  correlationIds: ["request-001", "job-001"],
  evidenceUris: ["https://example.test/evidence/incident-001"],
  monitoringStableMinutes: 17,
  followUps: [
    {
      owner: "operations-owner",
      dueAt: "2026-08-11T17:00:00.000Z",
      summary: "Assert the provider policy before deployment.",
    },
  ],
  attestation: {
    algorithm: "Ed25519",
    signer: "incident-commander",
    signedAt: "2026-08-04T11:10:00.000Z",
    signature:
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
  },
};

test("accepts a closed, redacted incident record", () => {
  assert.deepEqual(
    validateIncidentManifest(validManifest, { allowedAlerts: knownAlerts }),
    [],
  );
});

test("accepts an open incident draft without closure-only evidence", () => {
  const draft = {
    ...validManifest,
    status: "open",
    containedAt: undefined,
    recoveredAt: undefined,
    closedAt: undefined,
    containmentSummary: undefined,
    recoverySummary: undefined,
    rootCauseSummary: undefined,
    actions: [validManifest.actions[0]],
    monitoringStableMinutes: undefined,
    followUps: undefined,
    attestation: undefined,
  };
  assert.deepEqual(
    validateIncidentManifest(draft, { allowedAlerts: knownAlerts }),
    [],
  );
});

test("rejects a late acknowledgement and impossible timeline", () => {
  const violations = validateIncidentManifest(
    {
      ...validManifest,
      severity: "SEV1",
      securityEscalated: true,
      acknowledgedAt: "2026-08-04T10:16:00.000Z",
      containedAt: "2026-08-04T10:15:00.000Z",
    },
    { allowedAlerts: knownAlerts },
  );
  assert.match(violations.join("\n"), /acknowledgement exceeds 15/u);
  assert.match(violations.join("\n"), /containedAt cannot precede/u);
});

test("requires security escalation for uncertain data impact", () => {
  const violations = validateIncidentManifest(
    {
      ...validManifest,
      customerImpact: {
        ...validManifest.customerImpact,
        dataIntegrity: "unknown",
        dataExposure: "suspected",
      },
    },
    { allowedAlerts: knownAlerts },
  );
  assert.match(violations.join("\n"), /securityEscalated=true/u);
});

test("rejects unknown alerts, mutable images, and unsafe evidence keys", () => {
  const violations = validateIncidentManifest(
    {
      ...validManifest,
      triggeredAlerts: ["InventedAlert"],
      release: { ...validManifest.release, webImageRef: "example/web:latest" },
      investigation: { providerToken: "must-not-be-recorded" },
    },
    { allowedAlerts: knownAlerts },
  );
  assert.match(violations.join("\n"), /Unknown Prometheus alert/u);
  assert.match(violations.join("\n"), /digest-qualified/u);
  assert.match(violations.join("\n"), /providerToken.*forbidden/u);
});

test("requires closed-incident actions, monitoring, and follow-up evidence", () => {
  const violations = validateIncidentManifest(
    {
      ...validManifest,
      actions: [validManifest.actions[0]],
      evidenceUris: ["http://user:pass@example.test/evidence"],
      monitoringStableMinutes: 5,
      followUps: [],
    },
    { allowedAlerts: knownAlerts },
  );
  assert.match(violations.join("\n"), /requires a containment action/u);
  assert.match(violations.join("\n"), /credential-free HTTPS/u);
  assert.match(violations.join("\n"), /at least 15/u);
  assert.match(violations.join("\n"), /owned action/u);
});

test("rejects incident actions recorded out of order", () => {
  const violations = validateIncidentManifest(
    {
      ...validManifest,
      actions: [validManifest.actions[1], validManifest.actions[0]],
    },
    { allowedAlerts: knownAlerts },
  );
  assert.match(violations.join("\n"), /chronological action order/u);
});

test("verifies an Ed25519-attested incident manifest", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const manifest = {
    ...validManifest,
    attestation: { ...validManifest.attestation, signature: "" },
  };
  manifest.attestation.signature = sign(
    null,
    incidentManifestSigningPayload(manifest),
    privateKey,
  ).toString("base64");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  assert.deepEqual(
    validateIncidentManifestSignature(manifest, publicKeyPem),
    [],
  );
  assert.match(
    validateIncidentManifestSignature(
      { ...manifest, recoverySummary: "tampered" },
      publicKeyPem,
    ).join("\n"),
    /signature is invalid/u,
  );
});
