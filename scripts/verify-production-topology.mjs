import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { currentLegalAcceptance } from "./legal-acceptance.mjs";
import { integrationEndpoints } from "./integration-endpoints.mjs";
import { verifyStripeWebhookIdempotency } from "./verify-topology-stripe.mjs";

const { apiOrigins, mailpitOrigin, databaseUrl } = integrationEndpoints(
  process.env,
);
const email = `topology-${Date.now()}@example.test`;
const password = "Topology-Test-2026!";
const webhookSecret = "whsec_motionprep_topology_only";
const composeArgs = ["compose", "-f", "compose.integration.yaml"];
const fixture = await readFile("artifacts/fixtures/alpha-components.png");
const sha256 = createHash("sha256").update(fixture).digest("hex");
const processingTraceparent =
  "00-11111111111111111111111111111111-2222222222222222-01";
const exportTraceparent =
  "00-33333333333333333333333333333333-4444444444444444-01";
let cookie = "";

const registration = await api(0, "/v1/auth/register", {
  method: "POST",
  json: {
    name: "Topology Test",
    email,
    password,
    legal: currentLegalAcceptance,
  },
  expectedStatus: 201,
});
cookie = registration.cookie;
const userId = registration.body.data.user.id;

for (let attempt = 0; attempt < 5; attempt += 1) {
  await api(attempt % 2, "/v1/auth/login", {
    method: "POST",
    json: { email, password: `Wrong-${attempt}-Password` },
    expectedStatus: 400,
  });
}
const locked = await api(1, "/v1/auth/login", {
  method: "POST",
  json: { email, password },
  expectedStatus: 429,
});
if (locked.body.error?.code !== "ACCOUNT_LOCKED") {
  throw new Error("Redis lock was not shared across API replicas.");
}

await api(1, "/v1/auth/password-reset/request", {
  method: "POST",
  json: { email },
  expectedStatus: 202,
});
await waitFor(async () => {
  const response = await fetch(`${mailpitOrigin}/api/v1/messages`);
  if (!response.ok) return false;
  const messages = await response.json();
  return JSON.stringify(messages).includes(email);
}, "password-reset email in Mailpit");

const project = await api(0, "/v1/projects", {
  method: "POST",
  json: { name: "Topology Image", kind: "image" },
  expectedStatus: 201,
});
const projectId = project.body.data.id;
const intent = await api(1, "/v1/uploads/intents", {
  method: "POST",
  json: {
    projectId,
    filename: "topology.png",
    contentType: "image/png",
    sizeBytes: fixture.byteLength,
  },
  headers: { "x-idempotency-key": `upload-${projectId}` },
  expectedStatus: 201,
});
const uploadId = intent.body.data.uploadId;
const repeatedIntent = await api(0, "/v1/uploads/intents", {
  method: "POST",
  json: {
    projectId,
    filename: "topology.png",
    contentType: "image/png",
    sizeBytes: fixture.byteLength,
  },
  headers: { "x-idempotency-key": `upload-${projectId}` },
  expectedStatus: 201,
});
assertSameResource(
  uploadId,
  repeatedIntent.body.data.uploadId,
  "Upload intent idempotency was not shared across API replicas.",
);
const conflictingIntent = await api(0, "/v1/uploads/intents", {
  method: "POST",
  json: {
    projectId,
    filename: "different-name.png",
    contentType: "image/png",
    sizeBytes: fixture.byteLength,
  },
  headers: { "x-idempotency-key": `upload-${projectId}` },
  expectedStatus: 409,
});
assertErrorCode(conflictingIntent, "IDEMPOTENCY_CONFLICT");
const uploaded = await api(0, `/v1/uploads/${uploadId}/content`, {
  method: "PUT",
  body: fixture,
  headers: { "content-type": "image/png" },
  expectedStatus: 200,
});
if (uploaded.body.data.sha256 !== sha256) {
  throw new Error("Uploaded object SHA-256 does not match the source.");
}
if (uploaded.body.data.status !== "scanning") {
  throw new Error("An uploaded object bypassed the malware quarantine gate.");
}
let scannedUpload;
await waitFor(async (attempt) => {
  const status = await api(attempt % 2, `/v1/uploads/${uploadId}`, {
    expectedStatus: 200,
  });
  if (["rejected", "scan_failed", "failed", "cancelled"].includes(
    status.body.data.status,
  )) {
    throw new Error(`Clean fixture scan failed: ${status.body.data.status}`);
  }
  if (status.body.data.status !== "ready") return false;
  scannedUpload = status.body.data;
  return status.body.data.malwareScanVerdict === "clean";
}, "malware scan and quarantine promotion");
const sourceVersionId = scannedUpload.sourceVersionId;

const eicarSignature = Buffer.from([
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-",
  "ANTIVIRUS-TEST-FILE!$H+H*",
].join(""));
const maliciousFixture = Buffer.concat([fixture, eicarSignature]);
const maliciousProject = await api(0, "/v1/projects", {
  method: "POST",
  json: { name: "Malware Gate EICAR", kind: "image" },
  expectedStatus: 201,
});
const maliciousProjectId = maliciousProject.body.data.id;
const maliciousIntent = await api(1, "/v1/uploads/intents", {
  method: "POST",
  json: {
    projectId: maliciousProjectId,
    filename: "eicar-topology.png",
    contentType: "image/png",
    sizeBytes: maliciousFixture.byteLength,
  },
  headers: { "x-idempotency-key": `eicar-${maliciousProjectId}` },
  expectedStatus: 201,
});
const maliciousUpload = await api(
  0,
  `/v1/uploads/${maliciousIntent.body.data.uploadId}/content`,
  {
    method: "PUT",
    body: maliciousFixture,
    headers: { "content-type": "image/png" },
    expectedStatus: 200,
  },
);
if (maliciousUpload.body.data.status !== "scanning") {
  throw new Error("EICAR fixture bypassed the malware quarantine gate.");
}
await waitFor(async (attempt) => {
  const status = await api(
    attempt % 2,
    `/v1/uploads/${maliciousIntent.body.data.uploadId}`,
    { expectedStatus: 200 },
  );
  if (status.body.data.status === "scan_failed") {
    throw new Error("EICAR scan failed instead of producing a malicious verdict.");
  }
  return status.body.data.status === "rejected" &&
    status.body.data.malwareScanVerdict === "malicious";
}, "EICAR rejection and quarantine purge");
const blockedProcessing = await api(1, "/v1/processing/jobs", {
  method: "POST",
  json: {
    projectId: maliciousProjectId,
    sourceVersionId: maliciousUpload.body.data.sourceVersionId,
  },
  headers: { "x-idempotency-key": `blocked-eicar-${maliciousProjectId}` },
  expectedStatus: 409,
});
if (!blockedProcessing.body.error?.code) {
  throw new Error("Rejected EICAR source returned no processing error code.");
}
const processing = await api(1, "/v1/processing/jobs", {
  method: "POST",
  json: { projectId, sourceVersionId },
  headers: {
    "x-idempotency-key": `processing-${projectId}`,
    traceparent: processingTraceparent,
  },
  expectedStatus: 202,
});
const processingId = processing.body.data.id;
const repeatedProcessing = await api(0, "/v1/processing/jobs", {
  method: "POST",
  json: { projectId, sourceVersionId },
  headers: { "x-idempotency-key": `processing-${projectId}` },
  expectedStatus: 202,
});
assertSameResource(
  processingId,
  repeatedProcessing.body.data.id,
  "Processing idempotency was not shared across API replicas.",
);
await verifyJobTraceIdentity(
  "processing_jobs",
  processingId,
  processing.requestId,
  processingTraceparent,
);
await waitFor(async (attempt) => {
  const status = await api(attempt % 2, `/v1/processing/jobs/${processingId}`, {
    expectedStatus: 200,
  });
  if (status.body.data.status === "failed") {
    throw new Error(`Processing failed: ${status.body.data.errorCode}`);
  }
  return status.body.data.status === "ready";
}, "worker-backed image processing");

dockerCompose("restart", "api-a", "worker-media");
await waitFor(
  async () => {
    try {
      return (await fetch(`${apiOrigins[0]}/v1/health/ready`)).status === 200;
    } catch {
      return false;
    }
  },
  "API readiness after restart",
);
const layerDocument = await api(0, `/v1/projects/${projectId}/layer-document?sourceVersionId=${sourceVersionId}`, {
  expectedStatus: 200,
});
await api(1, `/v1/projects/${projectId}/review/approve`, {
  method: "POST",
  json: {
    sourceVersionId,
    documentRevision: layerDocument.body.data.revision,
  },
  headers: { "x-idempotency-key": `approve-${projectId}` },
  expectedStatus: 200,
});

dockerCompose("stop", "worker-export");
const exportJob = await api(0, "/v1/exports", {
  method: "POST",
  json: {
    projectId,
    sourceVersionId,
    documentRevision: layerDocument.body.data.revision,
    format: "psd",
    scope: "full-document",
    scale: 1,
    colorProfile: "sRGB",
    namingPresetId: "adobe-default",
  },
  headers: {
    "x-idempotency-key": `export-${projectId}`,
    traceparent: exportTraceparent,
  },
  expectedStatus: 202,
});
const exportId = exportJob.body.data.id;
const repeatedExport = await api(1, "/v1/exports", {
  method: "POST",
  json: {
    projectId,
    sourceVersionId,
    documentRevision: layerDocument.body.data.revision,
    format: "psd",
    scope: "full-document",
    scale: 1,
    colorProfile: "sRGB",
    namingPresetId: "adobe-default",
  },
  headers: { "x-idempotency-key": `export-${projectId}` },
  expectedStatus: 202,
});
assertSameResource(
  exportId,
  repeatedExport.body.data.id,
  "Export idempotency was not shared across API replicas.",
);
await verifyJobTraceIdentity(
  "export_jobs",
  exportId,
  exportJob.requestId,
  exportTraceparent,
);
const conflictingExport = await api(1, "/v1/exports", {
  method: "POST",
  json: {
    projectId,
    sourceVersionId,
    documentRevision: layerDocument.body.data.revision,
    format: "png-layers-json",
    scope: "full-document",
    scale: 1,
    colorProfile: "sRGB",
    namingPresetId: "adobe-default",
  },
  headers: { "x-idempotency-key": `export-${projectId}` },
  expectedStatus: 409,
});
assertErrorCode(conflictingExport, "IDEMPOTENCY_CONFLICT");
dockerCompose("start", "worker-export");
await waitFor(async (attempt) => {
  const status = await api(attempt % 2, `/v1/exports/${exportId}`, {
    expectedStatus: 200,
  });
  if (status.body.data.status === "failed") {
    throw new Error(`Export failed: ${status.body.data.errorCode}`);
  }
  return status.body.data.status === "ready";
}, "worker-backed export after restart");
const download = await fetch(`${apiOrigins[1]}/v1/exports/${exportId}/download`, {
  headers: { cookie },
});
if (!download.ok || (await download.arrayBuffer()).byteLength < 100) {
  throw new Error("Export artifact download is empty or unavailable.");
}

await verifyStripeWebhookIdempotency({
  targetUserId: userId,
  databaseUrl,
  webhookSecret,
  api,
});
await verifyOperationalSignals();
process.stdout.write(
  "Production topology verified: replicas, Redis, Mailpit, S3, workers, restart, export, and signed Stripe webhook.\n",
);

async function verifyOperationalSignals() {
  const response = await fetch(`${apiOrigins[0]}/internal/metrics`, {
    headers: {
      authorization:
        "Bearer metrics-integration-token-at-least-32-characters",
    },
  });
  const body = await response.text();
  for (const metric of [
    "motionprep_queue_oldest_queued_seconds",
    "motionprep_worker_up",
    "motionprep_job_duration_seconds_bucket",
    "motionprep_dependencies_ready 1",
  ]) {
    if (!body.includes(metric)) {
      throw new Error(`Operational metric is missing: ${metric}`);
    }
  }
}

async function verifyJobTraceIdentity(
  table,
  jobId,
  expectedRequestId,
  expectedTraceparent,
) {
  if (!new Set(["processing_jobs", "export_jobs"]).has(table)) {
    throw new Error(`Unsupported job table ${table}.`);
  }
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query(
      `SELECT correlation_id, trace_parent FROM ${table} WHERE id = $1`,
      [jobId],
    );
    const row = result.rows[0];
    if (
      row?.correlation_id !== expectedRequestId ||
      row?.trace_parent !== expectedTraceparent
    ) {
      throw new Error(
        `${table} did not preserve the originating request/trace identity.`,
      );
    }
  } finally {
    await pool.end();
  }
}

async function api(index, path, options = {}) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set("cookie", cookie);
  let body = options.body;
  if (options.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.json);
  }
  const response = await fetch(`${apiOrigins[index]}${path}`, {
    method: options.method ?? "GET",
    headers,
    body,
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  if (response.status !== options.expectedStatus) {
    throw new Error(
      `${options.method ?? "GET"} ${path} returned ${response.status}, expected ${options.expectedStatus}: ${text}`,
    );
  }
  return {
    body: parsed,
    requestId: response.headers.get("x-request-id"),
    cookie:
      response.headers.getSetCookie?.()[0]?.split(";")[0] ??
      response.headers.get("set-cookie")?.split(";")[0] ??
      "",
  };
}

async function waitFor(probe, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    if (await probe(attempt++)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function dockerCompose(...args) {
  const result = spawnSync("docker", [...composeArgs, ...args], {
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`docker compose ${args.join(" ")} failed.`);
  }
}

function assertSameResource(actual, expected, message) {
  if (!actual || actual !== expected) throw new Error(message);
}

function assertErrorCode(response, expectedCode) {
  if (response.body.error?.code !== expectedCode) {
    throw new Error(
      `Expected ${expectedCode}, received ${response.body.error?.code ?? "no error code"}.`,
    );
  }
}
