import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { loadPdfConfiguration } from "./load-pdf-config.mjs";
import { currentLegalAcceptance } from "./legal-acceptance.mjs";
import {
  runWithConcurrency,
  summarizeDurations,
} from "./load-test-utils.mjs";
import {
  growthFromBaseline,
  isCompleteMetricsSample,
  readLoadMetrics,
  summarizeMetricPeaks,
  withCaptureTime,
} from "./load-test-metrics.mjs";
import {
  assertTargetRelease,
  inspectTargetRelease,
} from "./load-release-identity.mjs";

const config = loadPdfConfiguration(process.env);
const fixture = await readFile(config.pdfPath);
const sourceSha256 = createHash("sha256").update(fixture).digest("hex");
const runId = randomUUID();
const startedAt = new Date();
const releaseIdentityBefore = await inspectTargetRelease(config);
assertTargetRelease(releaseIdentityBefore);
const timings = [];
const accountIndexes = Array.from(
  { length: config.accountPoolSize },
  (_, index) => index,
);
const accounts = await runWithConcurrency(
  accountIndexes,
  config.accountPoolSize,
  async (_, index) => registerLoadAccount(index),
);
const attempts = Array.from(
  { length: config.concurrency * config.iterationsPerUser },
  (_, index) => index,
);
const metricsBefore = await readLoadMetrics(config);
const metricSamples = metricsBefore
  ? [withCaptureTime(metricsBefore, startedAt)]
  : [];
let sampling = true;
let metricsSamplingError = null;
const metricsSampler = sampleMetricsWhileRunning().catch((error) => {
  metricsSamplingError =
    error instanceof Error ? error.message : "Metrics sampling failed.";
});
let results;
try {
  results = await runWithConcurrency(
    attempts,
    config.concurrency,
    async (_, index) =>
      executeJourney(index, accounts[index % accounts.length].cookie),
  );
} finally {
  sampling = false;
  await metricsSampler;
}
const metricsAfter = await readLoadMetrics(config);
if (metricsAfter) metricSamples.push(withCaptureTime(metricsAfter, new Date()));
const releaseIdentityAfter = await inspectTargetRelease(config);
const failures = results.filter((result) => !result.ok);
const errorRate = failures.length / Math.max(1, results.length);
const summary = summarizeDurations(timings);
const metricsComplete =
  !config.requireMetrics ||
  (metricSamples.length >= 2 && metricSamples.every(isCompleteMetricsSample));
const peakMetrics = summarizeMetricPeaks(metricSamples);
const apiResidentMemoryPeakDeltaBytes = growthFromBaseline(
  metricsBefore?.apiResidentMemoryBytes,
  peakMetrics.apiResidentMemoryBytes,
);
const workerResidentMemoryPeakDeltaBytes = growthFromBaseline(
  metricsBefore?.workerResidentMemoryBytes,
  peakMetrics.workerResidentMemoryBytes,
);
const acceptanceChecks = {
  errorRate: errorRate <= config.maxErrorRate,
  workflowP95:
    config.maxWorkflowP95Ms === 0 ||
    (summary.workflow?.p95Ms ?? Infinity) <= config.maxWorkflowP95Ms,
  metrics: metricsComplete && metricsSamplingError === null,
  apiMemory:
    config.maxApiRssGrowthBytes === 0 ||
    (apiResidentMemoryPeakDeltaBytes ?? Infinity) <=
      config.maxApiRssGrowthBytes,
  workerMemory:
    config.maxWorkerRssGrowthBytes === 0 ||
    (workerResidentMemoryPeakDeltaBytes ?? Infinity) <=
      config.maxWorkerRssGrowthBytes,
  queueAge:
    config.maxQueueAgeSeconds === 0 ||
    (peakMetrics.oldestQueuedSeconds ?? Infinity) <=
      config.maxQueueAgeSeconds,
  queueDrained:
    config.maxFinalQueueDepth === null ||
    (metricsAfter?.queueDepth ?? Infinity) <= config.maxFinalQueueDepth,
  releaseIdentity:
    releaseIdentityBefore === null ||
    (releaseIdentityBefore.passed && releaseIdentityAfter?.passed === true),
};
const report = {
  schemaVersion: 3,
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
  release: config.releaseIdentity
    ? {
        expected: {
          gitSha: config.releaseIdentity.releaseGitSha,
          applicationVersion: config.releaseIdentity.applicationVersion,
          runtimeImageRef: config.releaseIdentity.runtimeImageRef,
          webImageRef: config.releaseIdentity.webImageRef,
        },
        evidenceProvenance: {
          repository: config.releaseIdentity.evidenceRepository,
          gitSha: config.releaseIdentity.evidenceGitSha,
          gitRef: config.releaseIdentity.evidenceGitRef,
          workflowRunId: config.releaseIdentity.evidenceRunId,
        },
        before: releaseIdentityBefore,
        after: releaseIdentityAfter,
      }
    : null,
  load: {
    concurrency: config.concurrency,
    accountPoolSize: config.accountPoolSize,
    iterationsPerUser: config.iterationsPerUser,
    totalJourneys: results.length,
    reviewFlow: config.reviewFlow,
  },
  acceptance: {
    maxErrorRate: config.maxErrorRate,
    maxWorkflowP95Ms: config.maxWorkflowP95Ms || null,
    minConcurrency: config.minConcurrency,
    minTotalJourneys: config.minTotalJourneys,
    maxApiRssGrowthBytes: config.maxApiRssGrowthBytes || null,
    maxWorkerRssGrowthBytes: config.maxWorkerRssGrowthBytes || null,
    maxQueueAgeSeconds: config.maxQueueAgeSeconds || null,
    maxFinalQueueDepth: config.maxFinalQueueDepth,
  },
  outcome: {
    passed: Object.values(acceptanceChecks).every(Boolean),
    successes: results.length - failures.length,
    failures: failures.length,
    errorRate,
    checks: acceptanceChecks,
  },
  durations: summary,
  metrics: {
    before: metricsBefore,
    after: metricsAfter,
    samples: metricSamples,
    samplingError: metricsSamplingError,
    peak: peakMetrics,
    apiResidentMemoryDeltaBytes:
      metricsBefore?.apiResidentMemoryBytes !== undefined &&
      metricsAfter?.apiResidentMemoryBytes !== undefined
        ? metricsAfter.apiResidentMemoryBytes - metricsBefore.apiResidentMemoryBytes
        : null,
    apiResidentMemoryPeakDeltaBytes,
    workerResidentMemoryPeakDeltaBytes,
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

async function registerLoadAccount(index) {
  const suffix = `${runId.slice(0, 8)}-account-${index}`;
  const registration = await measure("register", () =>
    apiRequest("/v1/auth/register", {
      method: "POST",
      json: {
        name: `Load User ${index}`,
        email: `load-${suffix}@example.test`,
        password: "Load-Test-2026!",
        legal: currentLegalAcceptance,
      },
      expectedStatus: 201,
    }),
  );
  return { cookie: registration.cookie };
}

async function executeJourney(index, cookie) {
  const journeyStartedAt = performance.now();
  const suffix = `${runId.slice(0, 8)}-${index}`;
  const api = (path, options = {}) => apiRequest(path, options, cookie);
  try {
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
    let documentRevision;
    if (config.reviewFlow === "approval-required") {
      const layerDocument = await measure("review-document", () =>
        api(
          `/v1/projects/${projectId}/layer-document?sourceVersionId=${sourceVersionId}`,
          { expectedStatus: 200 },
        ),
      );
      documentRevision = layerDocument.body.data.revision;
      await measure("review-approve", () =>
        api(`/v1/projects/${projectId}/review/approve`, {
          method: "POST",
          json: { sourceVersionId, documentRevision },
          headers: { "x-idempotency-key": `approve-${suffix}` },
          expectedStatus: 200,
        }),
      );
    }
    const exportJob = await measure("export-submit", () =>
      api("/v1/exports", {
        method: "POST",
        json: {
          projectId,
          sourceVersionId,
          ...(documentRevision === undefined ? {} : { documentRevision }),
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

async function apiRequest(path, options = {}, cookie = "") {
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

async function measure(stage, operation) {
  const started = performance.now();
  try {
    return await operation();
  } finally {
    timings.push({ stage, durationMs: Math.round(performance.now() - started) });
  }
}

async function sampleMetricsWhileRunning() {
  if (!config.metricsUrl || !config.metricsToken) return;
  while (sampling) {
    await new Promise((resolve) =>
      setTimeout(resolve, config.metricsSampleIntervalMs),
    );
    if (!sampling) return;
    const sample = await readLoadMetrics(config);
    if (sample) metricSamples.push(withCaptureTime(sample, new Date()));
  }
}
