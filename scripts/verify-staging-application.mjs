import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const targetOrigin = requiredUrl("STAGING_ORIGIN", process.env.STAGING_ORIGIN);
const releaseGitSha = requiredMatch(
  "RELEASE_GIT_SHA",
  process.env.RELEASE_GIT_SHA,
  /^[a-f0-9]{40}$/u,
);
const applicationVersion = process.env.EXPECTED_APPLICATION_VERSION ?? "0.1.2";
const reportPath = resolve(
  process.env.STAGING_EVIDENCE_PATH ?? ".tmp/staging-application-evidence.json",
);
const startedAt = new Date().toISOString();

const webHealth = await fetchText("/healthz");
if (webHealth.status !== 200 || webHealth.body.trim() !== "ok") {
  throw new Error(`Web health failed with ${webHealth.status}: ${webHealth.body}`);
}
const apiHealth = await fetchJson("/v1/health/ready");
if (apiHealth.status !== 200) {
  throw new Error(`API readiness failed with ${apiHealth.status}.`);
}
if (apiHealth.body?.data?.release !== releaseGitSha) {
  throw new Error(
    `API release ${apiHealth.body?.data?.release ?? "missing"} does not match ${releaseGitSha}.`,
  );
}
if (apiHealth.body?.data?.version !== applicationVersion) {
  throw new Error(
    `API version ${apiHealth.body?.data?.version ?? "missing"} does not match ${applicationVersion}.`,
  );
}
const capabilities = await fetchJson("/v1/capabilities");
if (capabilities.status !== 200 || !capabilities.body?.data) {
  throw new Error("Server-authoritative capability discovery failed.");
}

const evidence = {
  schemaVersion: 1,
  startedAt,
  completedAt: new Date().toISOString(),
  targetOrigin,
  applicationVersion,
  releaseGitSha,
  imageReferences: {
    runtime: optionalImmutableReference("RUNTIME_IMAGE_REF"),
    web: optionalImmutableReference("WEB_IMAGE_REF"),
  },
  checks: {
    webHealth: "passed",
    apiReadiness: "passed",
    releaseIdentity: "passed",
    capabilityContract: "passed",
  },
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);

async function fetchText(path) {
  const response = await fetch(`${targetOrigin}${path}`, {
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.text() };
}

async function fetchJson(path) {
  const response = await fetch(`${targetOrigin}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${path} did not return JSON.`);
  }
  return { status: response.status, body };
}

function requiredUrl(name, value) {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  const url = new URL(value);
  const local = ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new Error(`${name} must use HTTPS outside local verification.`);
  }
  return url.origin;
}

function requiredMatch(name, value, pattern) {
  if (!value || !pattern.test(value)) throw new Error(`${name} is invalid.`);
  return value;
}

function optionalImmutableReference(name) {
  const value = process.env[name]?.trim();
  if (!value) return null;
  if (!/^.+@sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${name} must be pinned by sha256 digest.`);
  }
  return value;
}
