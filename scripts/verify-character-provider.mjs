import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_POLICY_PATH = "config/gpu-serverless-readiness-policy.json";

export async function runCharacterProviderReadiness({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  delay = abortableDelay,
  now = () => Date.now(),
} = {}) {
  const enabled = required(environment, "CHARACTER_RIG_ENABLED");
  if (!["true", "false"].includes(enabled)) {
    throw new Error("CHARACTER_RIG_ENABLED must be true or false.");
  }
  if (enabled === "false") {
    const evidence = {
      schemaVersion: 1,
      enabled: false,
      verified: false,
      status: "disabled",
      completedAt: new Date(now()).toISOString(),
      releaseGitSha: optional(environment, "RELEASE_GIT_SHA") ?? null,
      checks: ["feature-disabled"],
    };
    await writeEvidence(environment, evidence);
    return evidence;
  }
  const baseUrl = normalizeBaseUrl(required(environment, "CHARACTER_INFERENCE_URL"));
  assertSecureProviderUrl(baseUrl, environment);
  const apiKey = required(environment, "CHARACTER_INFERENCE_API_KEY");
  if (apiKey.length < 16) {
    throw new Error("CHARACTER_INFERENCE_API_KEY must contain at least 16 characters.");
  }
  if (optional(environment, "CHARACTER_INFERENCE_PROTOCOL") !== "async-v1") {
    throw new Error("GPU Serverless readiness requires CHARACTER_INFERENCE_PROTOCOL=async-v1.");
  }
  const policyPath = resolve(
    optional(environment, "CHARACTER_PROVIDER_READINESS_POLICY") ??
      DEFAULT_POLICY_PATH,
  );
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  const requestTimeoutMilliseconds = boundedInteger(
    environment.CHARACTER_PROVIDER_PROBE_REQUEST_TIMEOUT_MS,
    10_000,
    1_000,
    30_000,
    "CHARACTER_PROVIDER_PROBE_REQUEST_TIMEOUT_MS",
  );
  const operationTimeoutMilliseconds = boundedInteger(
    environment.CHARACTER_PROVIDER_PROBE_OPERATION_TIMEOUT_MS,
    60_000,
    requestTimeoutMilliseconds,
    5 * 60_000,
    "CHARACTER_PROVIDER_PROBE_OPERATION_TIMEOUT_MS",
  );
  const pollIntervalMilliseconds = boundedInteger(
    environment.CHARACTER_PROVIDER_PROBE_POLL_INTERVAL_MS,
    1_000,
    100,
    10_000,
    "CHARACTER_PROVIDER_PROBE_POLL_INTERVAL_MS",
  );
  const request = createProviderRequest({
    apiKey,
    fetchImpl,
    requestTimeoutMilliseconds,
  });

  const capabilitiesResponse = await request(
    "GET",
    new URL("v1/capabilities", baseUrl),
  );
  if (capabilitiesResponse.status !== 200) {
    throw new Error("Character provider capabilities probe did not return HTTP 200.");
  }
  const capabilities = await parseJsonResponse(capabilitiesResponse);
  verifyCapabilities(policy, capabilities);

  const probeId = randomUUID();
  const operationStartedAt = now();
  const submissionResponse = await request(
    "POST",
    new URL("v1/conformance/operations", baseUrl),
    {
      probeId,
      probeType: "control-plane",
      payloadContainsUserData: false,
    },
    probeId,
  );
  if (submissionResponse.status !== 202) {
    throw new Error("Character provider conformance submission did not return HTTP 202.");
  }
  const submission = await parseJsonResponse(submissionResponse);
  const operationId = requiredString(submission, "operationId", 200);
  const statusUrl = resolveStatusUrl(
    requiredString(submission, "statusUrl", 2_048),
    baseUrl,
  );
  let retryAfterMilliseconds = responseDelay(
    submissionResponse,
    submission.retryAfterMilliseconds,
    pollIntervalMilliseconds,
  );
  let pollCount = 0;

  while (true) {
    const elapsed = now() - operationStartedAt;
    if (elapsed >= operationTimeoutMilliseconds) {
      throw new Error("Character provider conformance operation timed out.");
    }
    await delay(
      Math.min(retryAfterMilliseconds, operationTimeoutMilliseconds - elapsed),
    );
    const pollResponse = await request("GET", statusUrl, undefined, probeId);
    const body = await parseJsonResponse(pollResponse);
    pollCount += 1;
    if (
      pollResponse.status === 202 &&
      (body.status === "queued" || body.status === "running")
    ) {
      retryAfterMilliseconds = responseDelay(
        pollResponse,
        body.retryAfterMilliseconds,
        Math.min(10_000, Math.ceil(retryAfterMilliseconds * 1.5)),
      );
      continue;
    }
    if (
      pollResponse.status === 200 &&
      body.status === "succeeded" &&
      body.probeId === probeId
    ) {
      break;
    }
    throw new Error("Character provider returned an invalid conformance operation state.");
  }

  const evidence = {
    schemaVersion: 1,
    enabled: true,
    verified: true,
    status: "verified",
    completedAt: new Date(now()).toISOString(),
    releaseGitSha: optional(environment, "RELEASE_GIT_SHA") ?? null,
    providerOrigin: baseUrl.origin,
    protocol: "async-v1",
    operationId,
    conformancePollCount: pollCount,
    conformanceDurationMilliseconds: now() - operationStartedAt,
    declaredAutoscaling: capabilities.autoscaling,
    declaredOperationBudgets: capabilities.operationBudgets,
    declaredPrivacy: capabilities.privacy,
    checks: [
      "https",
      "capabilities",
      "scale-to-zero-policy",
      "bounded-autoscaling",
      "retention-policy",
      "customer-data-training-disabled",
      "async-submission",
      "same-origin-status-polling",
      "idempotency-key",
      "terminal-success",
    ],
  };
  await writeEvidence(environment, evidence);
  return evidence;
}

export function verifyCapabilities(policy, capabilities) {
  if (!isRecord(policy) || policy.schemaVersion !== 1) {
    throw new Error("GPU Serverless readiness policy must use schemaVersion 1.");
  }
  if (policy.requiredProtocol !== "async-v1") {
    throw new Error("GPU Serverless readiness policy must require async-v1.");
  }
  if (!isRecord(capabilities) || capabilities.schemaVersion !== 1) {
    throw new Error("Character provider capabilities must use schemaVersion 1.");
  }
  if (
    !Array.isArray(capabilities.protocols) ||
    !capabilities.protocols.includes(policy.requiredProtocol)
  ) {
    throw new Error("Character provider does not declare the required async-v1 protocol.");
  }
  const autoscaling = requiredRecord(capabilities, "autoscaling");
  const autoscalingPolicy = requiredRecord(policy, "autoscaling");
  const requiredMinReplicas = requiredInteger(
    autoscalingPolicy,
    "requiredMinReplicas",
    0,
  );
  const maximumReplicas = requiredInteger(
    autoscalingPolicy,
    "maximumReplicas",
    1,
  );
  const maximumTargetConcurrency = requiredInteger(
    autoscalingPolicy,
    "maximumTargetConcurrency",
    1,
  );
  if (maximumReplicas < requiredMinReplicas) {
    throw new Error("GPU Serverless readiness policy has incoherent replica limits.");
  }
  if (autoscalingPolicy.requireScaleToZero !== true) {
    throw new Error("GPU Serverless readiness policy must require scale-to-zero.");
  }
  if (autoscaling.scaleToZero !== true) {
    throw new Error("Character provider must declare scale-to-zero support.");
  }
  const minReplicas = requiredInteger(autoscaling, "minReplicas", 0);
  const maxReplicas = requiredInteger(autoscaling, "maxReplicas", 1);
  const targetConcurrency = requiredInteger(
    autoscaling,
    "targetConcurrency",
    1,
  );
  if (minReplicas !== requiredMinReplicas) {
    throw new Error("Character provider minReplicas violates the readiness policy.");
  }
  if (maxReplicas < minReplicas || maxReplicas > maximumReplicas) {
    throw new Error("Character provider maxReplicas violates the readiness policy.");
  }
  if (targetConcurrency > maximumTargetConcurrency) {
    throw new Error("Character provider targetConcurrency violates the readiness policy.");
  }

  const budgets = requiredRecord(capabilities, "operationBudgets");
  const budgetPolicy = requiredRecord(policy, "operations");
  assertMaximum(
    budgets,
    "coldStartMilliseconds",
    requiredInteger(budgetPolicy, "maximumColdStartMilliseconds", 1),
  );
  assertMaximum(
    budgets,
    "queueMilliseconds",
    requiredInteger(budgetPolicy, "maximumQueueMilliseconds", 1),
  );
  assertMaximum(
    budgets,
    "operationMilliseconds",
    requiredInteger(budgetPolicy, "maximumOperationMilliseconds", 1),
  );

  const privacy = requiredRecord(capabilities, "privacy");
  const privacyPolicy = requiredRecord(policy, "privacy");
  assertMaximum(
    privacy,
    "inputRetentionSeconds",
    requiredInteger(privacyPolicy, "maximumInputRetentionSeconds", 0),
    0,
  );
  assertMaximum(
    privacy,
    "outputRetentionSeconds",
    requiredInteger(privacyPolicy, "maximumOutputRetentionSeconds", 0),
    0,
  );
  if (privacyPolicy.requireCustomerDataTrainingDisabled !== true) {
    throw new Error(
      "GPU Serverless readiness policy must disable training on customer data.",
    );
  }
  if (privacy.customerDataTraining !== false) {
    throw new Error("Character provider must disable training on customer data.");
  }
}

function createProviderRequest({
  apiKey,
  fetchImpl,
  requestTimeoutMilliseconds,
}) {
  return async function request(method, url, body, idempotencyKey) {
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "application/json",
          "x-motionprep-protocol-version": "1",
          ...(idempotencyKey
            ? { "x-idempotency-key": idempotencyKey }
            : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(requestTimeoutMilliseconds),
      });
    } catch {
      throw new Error("Character provider readiness request failed.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("Character provider rejected readiness credentials.");
    }
    if (response.status === 429 || response.status >= 500) {
      throw new Error("Character provider is unavailable for readiness verification.");
    }
    return response;
  };
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "CHARACTER_INFERENCE_URL cannot contain credentials, a query, or a fragment.",
    );
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function assertSecureProviderUrl(url, environment) {
  const allowLocalhost = environment.CHARACTER_INFERENCE_ALLOW_INSECURE_LOCALHOST === "true";
  const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(allowLocalhost && isLocalhost)) {
    throw new Error("Character provider readiness requires HTTPS.");
  }
}

function resolveStatusUrl(value, baseUrl) {
  let statusUrl;
  try {
    statusUrl = new URL(value, baseUrl);
  } catch {
    throw new Error("Character provider returned an invalid status URL.");
  }
  if (
    statusUrl.origin !== baseUrl.origin ||
    !statusUrl.pathname.startsWith(baseUrl.pathname) ||
    statusUrl.username ||
    statusUrl.password ||
    statusUrl.search ||
    statusUrl.hash
  ) {
    throw new Error("Character provider status URL violates the same-origin policy.");
  }
  return statusUrl;
}

async function parseJsonResponse(response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("Character provider readiness response is too large.");
  }
  const text = await readBoundedResponseText(response);
  try {
    const value = JSON.parse(text);
    if (!isRecord(value)) throw new Error("not an object");
    return value;
  } catch {
    throw new Error("Character provider readiness response is not valid JSON.");
  }
}

async function readBoundedResponseText(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Character provider readiness response is too large.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

function responseDelay(response, bodyDelay, fallback) {
  const headerDelay = parseRetryAfter(response.headers.get("retry-after"));
  const value = headerDelay ?? bodyDelay ?? fallback;
  return Number.isSafeInteger(value) && value >= 0
    ? Math.min(10_000, Math.max(100, value))
    : fallback;
}

function parseRetryAfter(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function boundedInteger(value, fallback, minimum, maximum, name) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function assertMaximum(record, key, maximum, minimum = 1) {
  const value = requiredInteger(record, key, minimum);
  if (!Number.isSafeInteger(maximum) || value > maximum) {
    throw new Error(`Character provider ${key} violates the readiness policy.`);
  }
}

function requiredInteger(record, key, minimum) {
  const value = record[key];
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`Character provider ${key} must be an integer of at least ${minimum}.`);
  }
  return value;
}

function requiredString(record, key, maximumLength) {
  if (!isRecord(record)) throw new Error("Character provider response must be an object.");
  const value = record[key];
  if (typeof value !== "string" || value.length < 1 || value.length > maximumLength) {
    throw new Error(`Character provider ${key} is invalid.`);
  }
  return value;
}

function requiredRecord(record, key) {
  if (!isRecord(record) || !isRecord(record[key])) {
    throw new Error(`Character provider ${key} must be an object.`);
  }
  return record[key];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optional(environment, name) {
  const value = environment[name]?.trim();
  return value ? value : undefined;
}

function required(environment, name) {
  const value = optional(environment, name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function writeEvidence(environment, evidence) {
  const evidencePath = optional(environment, "CHARACTER_PROVIDER_EVIDENCE_PATH");
  if (!evidencePath) return;
  const filename = resolve(evidencePath);
  await mkdir(dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function abortableDelay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const evidence = await runCharacterProviderReadiness();
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}
