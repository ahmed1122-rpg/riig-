import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  evidenceSigningPayload,
  validateEvidenceAttestation,
  validateEvidenceSignature,
} from "./evidence-attestation.mjs";

const digestReference = /^.+@sha256:[a-f0-9]{64}$/u;
const gitSha = /^[a-f0-9]{40}$/u;
const utcTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const severityTargets = new Map([
  ["SEV1", 15],
  ["SEV2", 30],
  ["SEV3", 4 * 60],
]);
const allowedStatuses = new Set(["open", "contained", "monitoring", "closed"]);
const allowedDetectionSources = new Set([
  "monitoring",
  "provider",
  "customer",
  "operator",
  "security",
]);
const allowedActionKinds = new Set([
  "detection",
  "containment",
  "recovery",
  "verification",
  "communication",
]);
const forbiddenEvidenceKey =
  /password|secret|token|cookie|authorization|mphaseed|recoverycode|uploadedcontent|rawcontent/iu;

export function validateIncidentManifest(
  manifest,
  { allowedAlerts = new Set() } = {},
) {
  const violations = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["Incident manifest must be a JSON object."];
  }

  if (manifest.schemaVersion !== 1) {
    violations.push("schemaVersion must be 1.");
  }
  for (const field of ["incidentId", "title", "environment"]) {
    requireText(manifest[field], field, violations);
  }
  if (!/^INC-[A-Z0-9-]{8,}$/u.test(manifest.incidentId ?? "")) {
    violations.push("incidentId must use the INC-<stable-id> format.");
  }
  if (!severityTargets.has(manifest.severity)) {
    violations.push("severity must be SEV1, SEV2, or SEV3.");
  }
  if (!allowedStatuses.has(manifest.status)) {
    violations.push("status must be open, contained, monitoring, or closed.");
  }
  const statusRank = new Map([
    ["open", 0],
    ["contained", 1],
    ["monitoring", 2],
    ["closed", 3],
  ]).get(manifest.status);
  if (statusRank >= 1) {
    requireText(manifest.containmentSummary, "containmentSummary", violations);
  }
  if (statusRank >= 2) {
    requireText(manifest.recoverySummary, "recoverySummary", violations);
  }
  if (statusRank >= 3) {
    requireText(manifest.rootCauseSummary, "rootCauseSummary", violations);
  }
  if (!allowedDetectionSources.has(manifest.detectionSource)) {
    violations.push(
      "detectionSource must be monitoring, provider, customer, operator, or security.",
    );
  }

  const times = {};
  const requiredTimeRank = new Map([
    ["detectedAt", 0],
    ["acknowledgedAt", 0],
    ["containedAt", 1],
    ["recoveredAt", 2],
    ["closedAt", 3],
  ]);
  for (const [field, minimumRank] of requiredTimeRank) {
    times[field] =
      statusRank >= minimumRank || manifest[field] !== undefined
        ? parseTimestamp(manifest[field], field, violations)
        : Number.NaN;
  }
  validateChronology(times, violations);
  const acknowledgmentTarget = severityTargets.get(manifest.severity);
  if (
    acknowledgmentTarget !== undefined &&
    Number.isFinite(times.detectedAt) &&
    Number.isFinite(times.acknowledgedAt) &&
    times.acknowledgedAt - times.detectedAt > acknowledgmentTarget * 60_000
  ) {
    violations.push(
      `${manifest.severity} acknowledgement exceeds ${acknowledgmentTarget} minutes.`,
    );
  }

  for (const role of [
    "incidentCommander",
    "technicalLead",
    "communicationsLead",
  ]) {
    requireText(manifest.roles?.[role], `roles.${role}`, violations);
  }
  requireTextArray(manifest.affectedServices, "affectedServices", violations);
  requireTextArray(manifest.correlationIds, "correlationIds", violations);
  validateAlerts(manifest, allowedAlerts, violations);

  if (!gitSha.test(manifest.release?.gitSha ?? "")) {
    violations.push("release.gitSha must be an exact 40-character commit SHA.");
  }
  for (const field of ["runtimeImageRef", "webImageRef"]) {
    if (!digestReference.test(manifest.release?.[field] ?? "")) {
      violations.push(`release.${field} must be a digest-qualified image reference.`);
    }
  }

  requireText(manifest.customerImpact?.summary, "customerImpact.summary", violations);
  if (
    !new Set(["verified-intact", "affected", "unknown"]).has(
      manifest.customerImpact?.dataIntegrity,
    )
  ) {
    violations.push(
      "customerImpact.dataIntegrity must be verified-intact, affected, or unknown.",
    );
  }
  if (
    !new Set(["not-detected", "suspected", "confirmed"]).has(
      manifest.customerImpact?.dataExposure,
    )
  ) {
    violations.push(
      "customerImpact.dataExposure must be not-detected, suspected, or confirmed.",
    );
  }
  if (
    (manifest.severity === "SEV1" ||
      manifest.customerImpact?.dataIntegrity !== "verified-intact" ||
      manifest.customerImpact?.dataExposure !== "not-detected") &&
    manifest.securityEscalated !== true
  ) {
    violations.push(
      "SEV1 or uncertain data impact requires securityEscalated=true.",
    );
  }

  validateActions(manifest, times, violations);
  validateEvidenceUris(manifest.evidenceUris, violations);
  if (
    manifest.status === "closed" &&
    (!Number.isInteger(manifest.monitoringStableMinutes) ||
      manifest.monitoringStableMinutes < 15)
  ) {
    violations.push(
      "A closed incident requires monitoringStableMinutes of at least 15.",
    );
  }
  if (manifest.status === "closed" || manifest.followUps !== undefined) {
    validateFollowUps(manifest.followUps, times.closedAt, violations);
  }
  if (manifest.status === "closed" || manifest.attestation !== undefined) {
    violations.push(...validateAttestationMetadata(manifest));
  }
  findForbiddenKeys(manifest, "$", violations);
  return [...new Set(violations)];
}

export function incidentManifestSigningPayload(manifest) {
  return evidenceSigningPayload(manifest);
}

export function validateIncidentManifestSignature(manifest, publicKeyPem) {
  return validateEvidenceSignature(manifest, publicKeyPem, {
    completedAt: manifest.closedAt,
    completionLabel: "incident closure",
    evidenceLabel: "Incident",
  });
}

function parseTimestamp(value, field, violations) {
  if (typeof value !== "string" || !utcTimestamp.test(value)) {
    violations.push(`${field} must be an ISO-8601 UTC timestamp ending in Z.`);
    return Number.NaN;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    violations.push(`${field} must be a valid timestamp.`);
  }
  return timestamp;
}

function validateChronology(times, violations) {
  const fields = [
    "detectedAt",
    "acknowledgedAt",
    "containedAt",
    "recoveredAt",
    "closedAt",
  ];
  for (let index = 1; index < fields.length; index += 1) {
    const previous = fields[index - 1];
    const current = fields[index];
    if (
      Number.isFinite(times[previous]) &&
      Number.isFinite(times[current]) &&
      times[current] < times[previous]
    ) {
      violations.push(`${current} cannot precede ${previous}.`);
    }
  }
}

function validateAlerts(manifest, allowedAlerts, violations) {
  const alerts = manifest.triggeredAlerts;
  if (!Array.isArray(alerts)) {
    violations.push("triggeredAlerts must be an array.");
    return;
  }
  if (manifest.detectionSource === "monitoring" && alerts.length === 0) {
    violations.push("Monitoring-detected incidents require a triggered alert.");
  }
  for (const alert of alerts) {
    if (typeof alert !== "string" || alert.trim() === "") {
      violations.push("triggeredAlerts entries must be non-empty strings.");
    } else if (allowedAlerts.size > 0 && !allowedAlerts.has(alert)) {
      violations.push(`Unknown Prometheus alert: ${alert}.`);
    }
  }
}

function validateActions(manifest, times, violations) {
  if (!Array.isArray(manifest.actions) || manifest.actions.length === 0) {
    violations.push("actions must contain incident timeline entries.");
    return;
  }
  const kinds = new Set();
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, action] of manifest.actions.entries()) {
    const prefix = `actions[${index}]`;
    const timestamp = parseTimestamp(action?.at, `${prefix}.at`, violations);
    if (
      Number.isFinite(timestamp) &&
      Number.isFinite(times.detectedAt) &&
      timestamp < times.detectedAt
    ) {
      violations.push(`${prefix}.at cannot precede detection.`);
    }
    if (
      Number.isFinite(timestamp) &&
      Number.isFinite(times.closedAt) &&
      timestamp > times.closedAt
    ) {
      violations.push(`${prefix}.at cannot follow closure.`);
    }
    if (Number.isFinite(timestamp) && timestamp < previousTimestamp) {
      violations.push(`${prefix}.at must preserve chronological action order.`);
    }
    if (Number.isFinite(timestamp)) previousTimestamp = timestamp;
    if (!allowedActionKinds.has(action?.kind)) {
      violations.push(`${prefix}.kind is not an allowed action kind.`);
    } else {
      kinds.add(action.kind);
    }
    requireText(action?.summary, `${prefix}.summary`, violations);
  }
  if (manifest.status === "closed") {
    for (const kind of ["containment", "recovery", "verification"]) {
      if (!kinds.has(kind)) {
        violations.push(`A closed incident requires a ${kind} action.`);
      }
    }
  }
}

function validateEvidenceUris(evidenceUris, violations) {
  if (!Array.isArray(evidenceUris) || evidenceUris.length === 0) {
    violations.push("evidenceUris must contain at least one HTTPS URI.");
    return;
  }
  for (const uri of evidenceUris) {
    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
        throw new Error("unsafe URI");
      }
    } catch {
      violations.push("evidenceUris entries must be credential-free HTTPS URIs.");
    }
  }
}

function validateFollowUps(followUps, closedAt, violations) {
  if (!Array.isArray(followUps) || followUps.length === 0) {
    violations.push("followUps must contain at least one owned action.");
    return;
  }
  for (const [index, followUp] of followUps.entries()) {
    const prefix = `followUps[${index}]`;
    requireText(followUp?.owner, `${prefix}.owner`, violations);
    requireText(followUp?.summary, `${prefix}.summary`, violations);
    const dueAt = parseTimestamp(followUp?.dueAt, `${prefix}.dueAt`, violations);
    if (
      Number.isFinite(dueAt) &&
      Number.isFinite(closedAt) &&
      dueAt <= closedAt
    ) {
      violations.push(`${prefix}.dueAt must follow incident closure.`);
    }
  }
}

function validateAttestationMetadata(manifest) {
  return validateEvidenceAttestation(manifest, {
    completedAt: manifest.closedAt,
    completionLabel: "incident closure",
  });
}

function findForbiddenKeys(value, path, violations) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (forbiddenEvidenceKey.test(key)) {
      violations.push(`${childPath} is forbidden in redacted incident evidence.`);
    }
    findForbiddenKeys(child, childPath, violations);
  }
}

function requireText(value, field, violations) {
  if (typeof value !== "string" || value.trim() === "") {
    violations.push(`${field} must be a non-empty string.`);
  }
}

function requireTextArray(value, field, violations) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || entry.trim() === "")
  ) {
    violations.push(`${field} must contain non-empty strings.`);
  }
}

async function main() {
  const filename = process.argv[2];
  if (!filename) {
    throw new Error(
      "Usage: node scripts/verify-incident-manifest.mjs <manifest.json> [--public-key <ed25519-public-key.pem>]",
    );
  }
  const [manifestText, alertRules] = await Promise.all([
    readFile(filename, "utf8"),
    readFile(new URL("../deploy/prometheus-alerts.yml", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  const allowedAlerts = new Set(
    [...alertRules.matchAll(/^\s*-\s+alert:\s+([A-Za-z0-9_]+)\s*$/gmu)].map(
      (match) => match[1],
    ),
  );
  const violations = validateIncidentManifest(manifest, { allowedAlerts });
  const publicKeyIndex = process.argv.indexOf("--public-key");
  if (publicKeyIndex >= 0) {
    const publicKeyFilename = process.argv[publicKeyIndex + 1];
    if (!publicKeyFilename) {
      violations.push("--public-key requires a PEM filename.");
    } else {
      const publicKeyPem = await readFile(publicKeyFilename, "utf8");
      violations.push(
        ...validateIncidentManifestSignature(manifest, publicKeyPem).filter(
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
  process.stdout.write(
    `Incident manifest verified: ${manifest.incidentId}, ${manifest.severity}, ${manifest.status}.\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
