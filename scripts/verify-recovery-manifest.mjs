import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  evidenceSigningPayload,
  validateEvidenceAttestation,
  validateEvidenceSignature,
} from "./evidence-attestation.mjs";

const digestReference = /^.+@sha256:[a-f0-9]{64}$/u;
const requiredTextFields = [
  "drillId",
  "databaseBackupId",
  "objectSnapshotId",
  "objectStorageBucket",
  "encryptionKeyId",
  "operator",
  "targetEnvironment",
];
const requiredTimeFields = [
  "incidentDetectedAt",
  "recoveryStartedAt",
  "databaseRestoreAt",
  "objectRestoreAt",
  "apiReadyAt",
  "smokeCompletedAt",
];

export function validateRecoveryManifest(manifest) {
  const violations = [];
  for (const field of requiredTextFields) {
    if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
      violations.push(`${field} must be a non-empty string.`);
    }
  }
  const times = {};
  for (const field of requiredTimeFields) {
    const timestamp = Date.parse(manifest[field]);
    if (!Number.isFinite(timestamp)) {
      violations.push(`${field} must be an ISO-8601 timestamp.`);
    } else {
      times[field] = timestamp;
    }
  }
  for (const field of ["runtimeImageRef", "webImageRef"]) {
    if (!digestReference.test(manifest[field] ?? "")) {
      violations.push(`${field} must be a digest-qualified image reference.`);
    }
  }
  if (
    Number.isFinite(times.databaseRestoreAt) &&
    Number.isFinite(times.objectRestoreAt) &&
    Math.abs(times.databaseRestoreAt - times.objectRestoreAt) > 15 * 60_000
  ) {
    violations.push(
      "Database and object-store recovery points differ by more than the 15-minute RPO.",
    );
  }
  if (
    Number.isFinite(times.incidentDetectedAt) &&
    Number.isFinite(times.databaseRestoreAt) &&
    times.incidentDetectedAt - times.databaseRestoreAt > 15 * 60_000
  ) {
    violations.push("Measured database RPO exceeds 15 minutes.");
  }
  if (
    Number.isFinite(times.incidentDetectedAt) &&
    Number.isFinite(times.objectRestoreAt) &&
    times.incidentDetectedAt - times.objectRestoreAt > 15 * 60_000
  ) {
    violations.push("Measured object-store RPO exceeds 15 minutes.");
  }
  if (
    Number.isFinite(times.recoveryStartedAt) &&
    Number.isFinite(times.smokeCompletedAt) &&
    times.smokeCompletedAt - times.recoveryStartedAt > 4 * 60 * 60_000
  ) {
    violations.push("Measured RTO exceeds four hours.");
  }
  if (
    Number.isFinite(times.apiReadyAt) &&
    Number.isFinite(times.smokeCompletedAt) &&
    times.smokeCompletedAt < times.apiReadyAt
  ) {
    violations.push("The smoke journey cannot complete before API readiness.");
  }
  if (manifest.integrity?.missingObjects !== 0) {
    violations.push("integrity.missingObjects must be zero.");
  }
  if (manifest.integrity?.corruptObjects !== 0) {
    violations.push("integrity.corruptObjects must be zero.");
  }
  if (manifest.integrity?.restoredJourneyPassed !== true) {
    violations.push("integrity.restoredJourneyPassed must be true.");
  }
  violations.push(...validateAttestationMetadata(manifest));
  return violations;
}

export function recoveryManifestSigningPayload(manifest) {
  return evidenceSigningPayload(manifest);
}

export function validateRecoveryManifestSignature(
  manifest,
  publicKeyPem,
) {
  return validateEvidenceSignature(manifest, publicKeyPem, {
    completedAt: manifest.smokeCompletedAt,
    completionLabel: "smoke completion",
    evidenceLabel: "Recovery",
  });
}

function validateAttestationMetadata(manifest) {
  return validateEvidenceAttestation(manifest, {
    completedAt: manifest.smokeCompletedAt,
    completionLabel: "smoke completion",
  });
}

async function main() {
  const filename = process.argv[2];
  if (!filename) {
    throw new Error(
      "Usage: node scripts/verify-recovery-manifest.mjs <manifest.json> [--public-key <ed25519-public-key.pem>]",
    );
  }
  const manifest = JSON.parse(await readFile(filename, "utf8"));
  const violations = validateRecoveryManifest(manifest);
  const publicKeyIndex = process.argv.indexOf("--public-key");
  if (publicKeyIndex >= 0) {
    const publicKeyFilename = process.argv[publicKeyIndex + 1];
    if (!publicKeyFilename) {
      violations.push("--public-key requires a PEM filename.");
    } else {
      const publicKeyPem = await readFile(publicKeyFilename, "utf8");
      violations.push(
        ...validateRecoveryManifestSignature(manifest, publicKeyPem).filter(
          (violation) => !violations.includes(violation),
        ),
      );
    }
  }
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }
  const rpoMinutes = Math.max(
    (Date.parse(manifest.incidentDetectedAt) -
      Math.min(
        Date.parse(manifest.databaseRestoreAt),
        Date.parse(manifest.objectRestoreAt),
      )) /
      60_000,
    0,
  );
  const rtoMinutes =
    (Date.parse(manifest.smokeCompletedAt) -
      Date.parse(manifest.recoveryStartedAt)) /
    60_000;
  const signatureStatus =
    publicKeyIndex >= 0 ? ", Ed25519 signature=valid" : "";
  process.stdout.write(
    `Recovery manifest verified: RPO=${rpoMinutes.toFixed(1)}m, RTO=${rtoMinutes.toFixed(1)}m${signatureStatus}.\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
