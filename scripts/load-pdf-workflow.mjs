import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  parseNonNegativeNumber,
  parsePositiveInteger,
  parseRate,
  prometheusMetricValues,
  runWithConcurrency,
  summarizeDurations,
} from "./load-test-utils.mjs";

const config = loadConfiguration(process.env);
const fixture = await readFile(config.pdfPath);
const sourceSha256 = createHash("sha256").update(fixture).digest("hex");
const runId = randomUUID();
const startedAt = new Date();
const timings = [];
const attempts = Array.from(
  { length: config.concurrency * config.iterationsPerUser },
  (_, index) => index,
);
const metricsBefore = await readMetrics(config);

const results = await runWithConcurrency(
  attempts,
  config.concurrency,
  async (_, index) => executeJourney(index),
);
const metricsAfter = await readMetrics(config);
const failures = results.filter((result) => !result.ok);
const errorRate = failures.length / Math.max(1, results.length);
const summary = summarizeDurations(timings);
const report = {
  schemaVersion: 1,
  runId,
  startedAt: startedAt.toISOString(),
  completedAt: new Date().toISOString(),
  targetOrigin: config.targetOrigin,
  requestOrigin: config.requestOrigin,
  source: {
    path: config.pdfPath,
    bytes: fixture.byteLength,
    sha256: sourceSha256,
  },
  load: {
    concurrency: config.concurrency,
    iterationsPerUser: config.iterationsPerUser,
    totalJourneys: results.length,
  },
  acceptance: {
    maxErrorRate: config.maxErrorRate,
    maxWorkflowP95Ms: config.maxWorkflowP95Ms || null,
  },
  outcome: {
    passed:
      errorRate <= config.maxErrorRate &&
      (config.maxWorkflowP95Ms === 0 ||
        (summary.workflow?.p95Ms ?? Infinity) <= config.maxWorkflowP95Ms),
    successes: results.length - failures.length,
    failures: failures.length,
    errorRate,
  },
  durations: summary,
  metrics: {
    before: metricsBefore,
    after: metricsAfter,
    apiResidentMemoryDeltaBytes:
      metricsBefore?.apiResidentMemoryBytes !== undefined &&
      metricsAfter?.apiResidentMemoryBytes !== undefined
        ? metricsAfter.apiResidentMemoryBytes - metricsBefore.apiResidentMemoryBytes
        : null,
    apiHeapUsedDeltaBytes:
      metricsBefore?.apiHeapUsedBytes !== undefined &&
      metricsAfter?.apiHeapUsedBytes !== undefined
        ? metricsAfter.apiHeapUsedBytes - metricsBefore.apiHeapUsedBytes
        : null,
    apiCpuDeltaSeconds:
      metricsBefore?.apiCpuSeconds !== undefined &&
      metricsAfter?.apiCpuSeconds !== undefined
        ? Number(
            (metricsAfter.apiCpuSeconds - metricsBefore.apiCpuSeconds).toFixed(6),
          )
        : null,
  },
  failureDetails: failures.map((failure) => ({
    index: failure.index,
    message: failure.message,
  })),
};

await mkdir(dirname(config.reportPath), { recursive: true });
await writeFile(config.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.outcome.passed) process.exitCode = 1;

async function executeJourney(index) {
  const journeyStartedAt = performance.now();
  let cookie = "";
  const suffix = `${runId.slice(0, 8)}-${index}`;
  try {
    const registration = await measure("register", () =>
      api("/v1/auth/register", {
        method: "POST",
        json: {
          name: `Load User ${index}`,
          email: `load-${suffix}@example.test`,
          password: "Load-Test-2026!",
        },
        expectedStatus: 201,
      }),
    );
    cookie = registration.cookie;
    const project = await measure("project", () =>
      api("/v1/projects", {
        method: "POST",
        json: { name: `Load PDF ${index}`, kind: "book" },
        expectedStatus: 201,
      }),
    );
    const projectId = project.body.data.id;
    const intent = await measure("upload-intent", () =>
      api("/v1/uploads/intents", {
        method: "POST",
        json: {
          projectId,
          filename: `load-${suffix}.pdf`,
          contentType: "application/pdf",
          sizeBytes: fixture.byteLength,
        },
        headers: { "x-idempotency-key": `upload-${suffix}` },
        expectedStatus: 201,
      }),
    );
    const upload = await measure("upload-content", () =>
      api(`/v1/uploads/${intent.body.data.uploadId}/content`, {
        method: "PUT",
        body: fixture,
        headers: { "content-type": "application/pdf" },
        expectedStatus: 200,
      }),
    );
    if (upload.body.data.sha256 !== sourceSha256) {
      throw new Error("Server upload SHA-256 differs from the load fixture.");
    }
    const sourceVersionId = upload.body.data.sourceVersionId;
    const processing = await measure("processing-submit", () =>
      api("/v1/processing/jobs", {
        method: "POST",
        json: { projectId, sourceVersionId },
        headers: { "x-idempotency-key": `processing-${suffix}` },
        expectedStatus: 202,
      }),
    );
    await measure("processing-ready", () =>
      waitForJob(`/v1/processing/jobs/${processing.body.data.id}`, "processing"),
    );
    const exportJob = await measure("export-submit", () =>
      api("/v1/exports", {
        method: "POST",
        json: {
          projectId,
          sourceVersionId,
          format: "psd",
          scope: "full-document",
          scale: 1,
          colorProfile: "sRGB",
          namingPresetId: "adobe-default",
        },
        headers: { "x-idempotency-key": `export-${suffix}` },
        expectedStatus: 202,
      }),
    );
    await measure("export-ready", () =>
      waitForJob(`/v1/exports/${exportJob.body.data.id}`, "export"),
    );
    await measure("download", async () => {
      const response = await fetch(
        `${config.targetOrigin}/v1/exports/${exportJob.body.data.id}/download`,
        {
          headers: { cookie },
          signal: AbortSignal.timeout(config.requestTimeoutMs),
        },
      );
      if (!response.ok) throw new Error(`Download returned ${response.status}.`);
      const artifact = await response.arrayBuffer();
      if (artifact.byteLength < 100) throw new Error("Export artifact is empty.");
    });
    timings.push({
      stage: "workflow",
      durationMs: Math.round(performance.now() - journeyStartedAt),
    });
    return { ok: true, index };
  } catch (error) {
    return {
      ok: false,
      index,
      message: error instanceof Error ? error.message : "Unknown load failure.",
    };
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers);
    headers.set("origin", config.requestOrigin);
    if (cookie) headers.set("cookie", cookie);
    let body = options.body;
    if (options.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.json);
    }
    const response = await fetch(`${config.targetOrigin}${path}`, {
      method: options.method ?? "GET",
      headers,
      body,
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : null;
    if (response.status !== options.expectedStatus) {
      throw new Error(
        `${options.method ?? "GET"} ${path} returned ${response.status}, expected ${options.expectedStatus}: ${text.slice(0, 300)}`,
      );
    }
    return {
      body: parsed,
      cookie:
        response.headers.getSetCookie?.()[0]?.split(";")[0] ??
        response.headers.get("set-cookie")?.split(";")[0] ??
        "",
    };
  }

  async function waitForJob(path, label) {
    const deadline = Date.now() + config.jobTimeoutMs;
    while (Date.now() < deadline) {
      const status = await api(path, { expectedStatus: 200 });
      if (status.body.data.status === "failed") {
        throw new Error(`${label} failed: ${status.body.data.errorCode}`);
      }
      if (status.body.data.status === "ready") return;
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    }
    throw new Error(`${label} did not become ready within ${config.jobTimeoutMs}ms.`);
  }
}

async function measure(stage, operation) {
  const started = performance.now();
  try {
    return await operation();
  } finally {
    timings.push({ stage, durationMs: Math.round(performance.now() - started) });
  }
}

async function readMetrics(targetConfig) {
  if (!targetConfig.metricsUrl || !targetConfig.metricsToken) return null;
  const response = await fetch(targetConfig.metricsUrl, {
    headers: { authorization: `Bearer ${targetConfig.metricsToken}` },
    signal: AbortSignal.timeout(targetConfig.requestTimeoutMs),
  });
  if (!response.ok) throw new Error(`Metrics endpoint returned ${response.status}.`);
  const body = await response.text();
  const queueDepthValues = prometheusMetricValues(
    body,
    "motionprep_queue_jobs",
    { state: "queued" },
  );
  const queueAgeValues = prometheusMetricValues(
    body,
    "motionprep_queue_oldest_queued_seconds",
  );
  const cpuValues = prometheusMetricValues(
    body,
    "motionprep_process_cpu_seconds_total",
  );
  return {
    apiResidentMemoryBytes: prometheusMetricValues(
      body,
      "motionprep_process_resident_memory_bytes",
    )[0],
    apiHeapUsedBytes: prometheusMetricValues(
      body,
      "motionprep_process_heap_used_bytes",
    )[0],
    apiCpuSeconds: cpuValues.length
      ? cpuValues.reduce((total, value) => total + value, 0)
      : undefined,
    queueDepth: queueDepthValues.length
      ? queueDepthValues.reduce((total, value) => total + value, 0)
      : undefined,
    oldestQueuedSeconds: queueAgeValues.length
      ? Math.max(...queueAgeValues)
      : undefined,
  };
}

function loadConfiguration(environment) {
  const targetOrigin = new URL(
    environment.LOAD_TARGET_ORIGIN ?? "http://127.0.0.1:54101",
  ).origin;
  if (
    environment.LOAD_EXPECTED_HOST &&
    new URL(targetOrigin).hostname !== environment.LOAD_EXPECTED_HOST
  ) {
    throw new Error("LOAD_TARGET_ORIGIN does not match LOAD_EXPECTED_HOST.");
  }
  const metricsUrl = environment.LOAD_METRICS_URL?.trim() || null;
  const metricsToken = environment.LOAD_METRICS_BEARER_TOKEN?.trim() || null;
  if (Boolean(metricsUrl) !== Boolean(metricsToken)) {
    throw new Error(
      "LOAD_METRICS_URL and LOAD_METRICS_BEARER_TOKEN must be configured together.",
    );
  }
  if (environment.LOAD_REQUIRE_METRICS === "true" && !metricsUrl) {
    throw new Error("LOAD_REQUIRE_METRICS requires the protected metrics endpoint.");
  }
  return {
    targetOrigin,
    requestOrigin: new URL(
      environment.LOAD_REQUEST_ORIGIN ?? targetOrigin,
    ).origin,
    pdfPath: resolve(
      environment.LOAD_PDF_PATH?.trim() ||
        "artifacts/fixtures/motionprep-e2e.pdf",
    ),
    reportPath: resolve(environment.LOAD_REPORT_PATH ?? ".tmp/pdf-load-report.json"),
    concurrency: parsePositiveInteger(environment.LOAD_CONCURRENCY, 1, "LOAD_CONCURRENCY", 16),
    iterationsPerUser: parsePositiveInteger(environment.LOAD_ITERATIONS, 1, "LOAD_ITERATIONS", 20),
    requestTimeoutMs: parsePositiveInteger(environment.LOAD_REQUEST_TIMEOUT_MS, 30_000, "LOAD_REQUEST_TIMEOUT_MS", 300_000),
    jobTimeoutMs: parsePositiveInteger(environment.LOAD_JOB_TIMEOUT_MS, 180_000, "LOAD_JOB_TIMEOUT_MS", 900_000),
    pollIntervalMs: parsePositiveInteger(environment.LOAD_POLL_INTERVAL_MS, 500, "LOAD_POLL_INTERVAL_MS", 10_000),
    maxErrorRate: parseRate(environment.LOAD_MAX_ERROR_RATE, 0, "LOAD_MAX_ERROR_RATE"),
    maxWorkflowP95Ms: parseNonNegativeNumber(environment.LOAD_MAX_WORKFLOW_P95_MS, 0, "LOAD_MAX_WORKFLOW_P95_MS"),
    metricsUrl,
    metricsToken,
  };
}
