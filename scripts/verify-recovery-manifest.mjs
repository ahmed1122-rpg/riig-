import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
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
    Number.isFinite(times.recoveryStartedAt) &&
    Number.isFinite(times.incidentDetectedAt) &&
    times.recoveryStartedAt < times.incidentDetectedAt
  ) {
    violations.push("Recovery cannot start before the incident is detected.");
  }
  for (const field of ["databaseRestoreAt", "objectRestoreAt"]) {
    if (
      Number.isFinite(times[field]) &&
      Number.isFinite(times.incidentDetectedAt) &&
      times[field] > times.incidentDetectedAt
    ) {
      violations.push(`${field} recovery point cannot be after incident detection.`);
    }
  }
  if (
    Number.isFinite(times.apiReadyAt) &&
    Number.isFinite(times.recoveryStartedAt) &&
    times.apiReadyAt < times.recoveryStartedAt
  ) {
    violations.push("API readiness cannot occur before recovery starts.");
  }
  if (
    Number.isFinite(times.smokeCompletedAt) &&
    Number.isFinite(times.recoveryStartedAt) &&
    times.smokeCompletedAt < times.recoveryStartedAt
  ) {
    violations.push("The smoke journey cannot complete before recovery starts.");
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

export function createRecoveryVerificationEvidence(
  manifestSource,
  publicKeyPem,
  manifest,
  generatedAt = new Date(),
  releaseCoordinates = null,
) {
  const rpoMinutes = measuredRpoMinutes(manifest);
  const rtoMinutes = measuredRtoMinutes(manifest);
  return {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    manifestDigest: sha256(manifestSource),
    verificationKeyDigest: sha256(publicKeyPem),
    smokeCompletedAt: manifest.smokeCompletedAt,
    measurements: {
      rpoMinutes,
      rtoMinutes,
    },
    checks: {
      structure: "passed",
      integrity: "passed",
      rpo: "passed",
      rto: "passed",
      ed25519Signature: "passed",
    },
    ...(releaseCoordinates ? { release: releaseCoordinates } : {}),
  };
}

export function validateRecoveryReleaseCoordinates(manifest, source) {
  const values = new Map();
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator > 0) {
      values.set(line.slice(0, separator), line.slice(separator + 1));
    }
  }
  const coordinates = {
    gitSha: values.get("RELEASE_GIT_SHA") ?? "",
    runtimeImageRef: values.get("RUNTIME_IMAGE_REF") ?? "",
    webImageRef: values.get("WEB_IMAGE_REF") ?? "",
  };
  const violations = [];
  if (!/^[a-f0-9]{40}$/u.test(coordinates.gitSha)) {
    violations.push("Recovery release environment requires an exact Git SHA.");
  }
  if (manifest.runtimeImageRef !== coordinates.runtimeImageRef) {
    violations.push("Recovery runtime image does not match the candidate digest.");
  }
  if (manifest.webImageRef !== coordinates.webImageRef) {
    violations.push("Recovery web image does not match the candidate digest.");
  }
  return { coordinates, violations };
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
      "Usage: node scripts/verify-recovery-manifest.mjs <manifest.json> [--public-key <ed25519-public-key.pem>] [--release-env <release.env>] [--evidence <redacted.json>]",
    );
  }
  const manifestSource = await readFile(filename, "utf8");
  const manifest = JSON.parse(manifestSource);
  const violations = validateRecoveryManifest(manifest);
  const publicKeyIndex = process.argv.indexOf("--public-key");
  const evidenceIndex = process.argv.indexOf("--evidence");
  const releaseEnvironmentIndex = process.argv.indexOf("--release-env");
  let publicKeyPem = null;
  let releaseCoordinates = null;
  if (publicKeyIndex >= 0) {
    const publicKeyFilename = process.argv[publicKeyIndex + 1];
    if (!publicKeyFilename) {
      violations.push("--public-key requires a PEM filename.");
    } else {
      publicKeyPem = await readFile(publicKeyFilename, "utf8");
      violations.push(
        ...validateRecoveryManifestSignature(manifest, publicKeyPem).filter(
          (violation) => !violations.includes(violation),
        ),
      );
    }
  }
  if (evidenceIndex >= 0 && !process.argv[evidenceIndex + 1]) {
    violations.push("--evidence requires a JSON filename.");
  }
  if (evidenceIndex >= 0 && !publicKeyPem) {
    violations.push("--evidence requires verified --public-key evidence.");
  }
  if (releaseEnvironmentIndex >= 0) {
    const releaseEnvironmentFilename = process.argv[releaseEnvironmentIndex + 1];
    if (!releaseEnvironmentFilename) {
      violations.push("--release-env requires an environment filename.");
    } else {
      const releaseEnvironmentSource = await readFile(
        releaseEnvironmentFilename,
        "utf8",
      );
      const validation = validateRecoveryReleaseCoordinates(
        manifest,
        releaseEnvironmentSource,
      );
      releaseCoordinates = validation.coordinates;
      violations.push(...validation.violations);
    }
  }
  if (evidenceIndex >= 0 && !releaseCoordinates) {
    violations.push("--evidence requires candidate-bound --release-env coordinates.");
  }
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }
  const rpoMinutes = measuredRpoMinutes(manifest);
  const rtoMinutes = measuredRtoMinutes(manifest);
  if (evidenceIndex >= 0) {
    const evidence = createRecoveryVerificationEvidence(
      manifestSource,
      publicKeyPem,
      manifest,
      new Date(),
      releaseCoordinates,
    );
    await writeFile(
      process.argv[evidenceIndex + 1],
      `${JSON.stringify(evidence, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }
  const signatureStatus =
    publicKeyIndex >= 0 ? ", Ed25519 signature=valid" : "";
  process.stdout.write(
    `Recovery manifest verified: RPO=${rpoMinutes.toFixed(1)}m, RTO=${rtoMinutes.toFixed(1)}m${signatureStatus}.\n`,
  );
}

function measuredRpoMinutes(manifest) {
  return Math.max(
    (Date.parse(manifest.incidentDetectedAt) -
      Math.min(
        Date.parse(manifest.databaseRestoreAt),
        Date.parse(manifest.objectRestoreAt),
      )) /
      60_000,
    0,
  );
}

function measuredRtoMinutes(manifest) {
  return (
    (Date.parse(manifest.smokeCompletedAt) -
      Date.parse(manifest.recoveryStartedAt)) /
    60_000
  );
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
