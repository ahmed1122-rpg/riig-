import {
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

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
  const { signature: _signature, ...attestation } =
    manifest.attestation ?? {};
  return Buffer.from(
    canonicalJson({
      ...manifest,
      attestation,
    }),
    "utf8",
  );
}

export function validateRecoveryManifestSignature(
  manifest,
  publicKeyPem,
) {
  const violations = validateAttestationMetadata(manifest);
  if (violations.length > 0) {
    return violations;
  }

  const signature = Buffer.from(
    manifest.attestation.signature,
    "base64",
  );
  try {
    const publicKey = createPublicKey(publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519") {
      violations.push("Recovery signing public key must be Ed25519.");
    } else if (
      !verifySignature(
        null,
        recoveryManifestSigningPayload(manifest),
        publicKey,
        signature,
      )
    ) {
      violations.push("Recovery manifest signature is invalid.");
    }
  } catch (error) {
    violations.push(
      `Recovery signing public key is invalid: ${message(error)}`,
    );
  }
  return violations;
}

function validateAttestationMetadata(manifest) {
  const violations = [];
  if (manifest.attestation?.algorithm !== "Ed25519") {
    violations.push("attestation.algorithm must be Ed25519.");
  }
  if (
    typeof manifest.attestation?.signer !== "string" ||
    manifest.attestation.signer.trim() === ""
  ) {
    violations.push("attestation.signer must be a non-empty string.");
  }
  const signedAt = Date.parse(manifest.attestation?.signedAt);
  if (!Number.isFinite(signedAt)) {
    violations.push("attestation.signedAt must be an ISO-8601 timestamp.");
  } else if (
    Number.isFinite(Date.parse(manifest.smokeCompletedAt)) &&
    signedAt < Date.parse(manifest.smokeCompletedAt)
  ) {
    violations.push(
      "attestation.signedAt cannot precede smoke completion.",
    );
  }

  const signatureText = manifest.attestation?.signature;
  const signature =
    typeof signatureText === "string"
      ? Buffer.from(signatureText, "base64")
      : Buffer.alloc(0);
  if (
    signature.byteLength !== 64 ||
    signature.toString("base64") !== signatureText
  ) {
    violations.push(
      "attestation.signature must be a 64-byte Ed25519 signature in base64.",
    );
  }
  return violations;
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

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function message(error) {
  return error instanceof Error ? error.message : "unknown error";
}
