import {
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import { canonicalJson } from "./ocr-holdout-policy.mjs";

const utcTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export function evidenceSigningPayload(manifest) {
  const { signature: _signature, ...attestation } = manifest.attestation ?? {};
  return Buffer.from(canonicalJson({ ...manifest, attestation }), "utf8");
}

export function validateEvidenceAttestation(
  manifest,
  { completedAt, completionLabel },
) {
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
  const signedAtText = manifest.attestation?.signedAt;
  const signedAt = Date.parse(signedAtText);
  if (
    typeof signedAtText !== "string" ||
    !utcTimestamp.test(signedAtText) ||
    !Number.isFinite(signedAt)
  ) {
    violations.push("attestation.signedAt must be an ISO-8601 UTC timestamp.");
  } else if (Number.isFinite(Date.parse(completedAt)) && signedAt < Date.parse(completedAt)) {
    violations.push(`attestation.signedAt cannot precede ${completionLabel}.`);
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

export function validateEvidenceSignature(
  manifest,
  publicKeyPem,
  { completedAt, completionLabel, evidenceLabel },
) {
  const violations = validateEvidenceAttestation(manifest, {
    completedAt,
    completionLabel,
  });
  if (violations.length > 0) return violations;
  try {
    const publicKey = createPublicKey(publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519") {
      violations.push(`${evidenceLabel} signing public key must be Ed25519.`);
    } else if (
      !verifySignature(
        null,
        evidenceSigningPayload(manifest),
        publicKey,
        Buffer.from(manifest.attestation.signature, "base64"),
      )
    ) {
      violations.push(`${evidenceLabel} manifest signature is invalid.`);
    }
  } catch (error) {
    violations.push(
      `${evidenceLabel} signing public key is invalid: ${message(error)}`,
    );
  }
  return violations;
}

function message(error) {
  return error instanceof Error ? error.message : "unknown error";
}
