import { resolve } from "node:path";
import {
  parseNonNegativeNumber,
  parsePositiveInteger,
  parseRate,
} from "./load-test-utils.mjs";

export function loadPdfConfiguration(environment) {
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
    throw new Error(
      "LOAD_REQUIRE_METRICS requires the protected metrics endpoint.",
    );
  }
  const reviewFlow = environment.LOAD_REVIEW_FLOW?.trim() || "approval-required";
  if (!new Set(["approval-required", "pre-approval"]).has(reviewFlow)) {
    throw new Error(
      "LOAD_REVIEW_FLOW must be approval-required or pre-approval.",
    );
  }
  const concurrency = parsePositiveInteger(
    environment.LOAD_CONCURRENCY,
    1,
    "LOAD_CONCURRENCY",
    32,
  );
  const iterationsPerUser = parsePositiveInteger(
    environment.LOAD_ITERATIONS,
    1,
    "LOAD_ITERATIONS",
    20,
  );
  const accountPoolSize = parsePositiveInteger(
    environment.LOAD_ACCOUNT_POOL_SIZE,
    Math.min(concurrency, 10),
    "LOAD_ACCOUNT_POOL_SIZE",
    32,
  );
  if (accountPoolSize > concurrency) {
    throw new Error("LOAD_ACCOUNT_POOL_SIZE cannot exceed LOAD_CONCURRENCY.");
  }
  const minConcurrency = parsePositiveInteger(
    environment.LOAD_MIN_CONCURRENCY,
    1,
    "LOAD_MIN_CONCURRENCY",
    32,
  );
  const minTotalJourneys = parsePositiveInteger(
    environment.LOAD_MIN_TOTAL_JOURNEYS,
    1,
    "LOAD_MIN_TOTAL_JOURNEYS",
    320,
  );
  if (concurrency < minConcurrency) {
    throw new Error(
      `LOAD_CONCURRENCY must be at least LOAD_MIN_CONCURRENCY (${minConcurrency}).`,
    );
  }
  if (concurrency * iterationsPerUser < minTotalJourneys) {
    throw new Error(
      `Load policy requires at least ${minTotalJourneys} total journeys.`,
    );
  }
  const maxFinalQueueDepth = parseNonNegativeNumber(
    environment.LOAD_MAX_FINAL_QUEUE_DEPTH,
    0,
    "LOAD_MAX_FINAL_QUEUE_DEPTH",
  );
  if (!Number.isInteger(maxFinalQueueDepth)) {
    throw new Error("LOAD_MAX_FINAL_QUEUE_DEPTH must be an integer.");
  }
  const releaseIdentity = parseReleaseIdentity(environment);
  return {
    targetOrigin,
    requestOrigin: new URL(
      environment.LOAD_REQUEST_ORIGIN ?? targetOrigin,
    ).origin,
    pdfPath: resolve(
      environment.LOAD_PDF_PATH?.trim() ||
        "artifacts/fixtures/motionprep-e2e.pdf",
    ),
    reportPath: resolve(
      environment.LOAD_REPORT_PATH ?? ".tmp/pdf-load-report.json",
    ),
    concurrency,
    accountPoolSize,
    iterationsPerUser,
    minConcurrency,
    minTotalJourneys,
    requestTimeoutMs: parsePositiveInteger(
      environment.LOAD_REQUEST_TIMEOUT_MS,
      30_000,
      "LOAD_REQUEST_TIMEOUT_MS",
      300_000,
    ),
    jobTimeoutMs: parsePositiveInteger(
      environment.LOAD_JOB_TIMEOUT_MS,
      180_000,
      "LOAD_JOB_TIMEOUT_MS",
      900_000,
    ),
    pollIntervalMs: parsePositiveInteger(
      environment.LOAD_POLL_INTERVAL_MS,
      500,
      "LOAD_POLL_INTERVAL_MS",
      10_000,
    ),
    maxErrorRate: parseRate(
      environment.LOAD_MAX_ERROR_RATE,
      0,
      "LOAD_MAX_ERROR_RATE",
    ),
    maxWorkflowP95Ms: parseNonNegativeNumber(
      environment.LOAD_MAX_WORKFLOW_P95_MS,
      0,
      "LOAD_MAX_WORKFLOW_P95_MS",
    ),
    maxApiRssGrowthBytes: parseNonNegativeNumber(
      environment.LOAD_MAX_API_RSS_GROWTH_BYTES,
      0,
      "LOAD_MAX_API_RSS_GROWTH_BYTES",
    ),
    maxWorkerRssGrowthBytes: parseNonNegativeNumber(
      environment.LOAD_MAX_WORKER_RSS_GROWTH_BYTES,
      0,
      "LOAD_MAX_WORKER_RSS_GROWTH_BYTES",
    ),
    maxQueueAgeSeconds: parseNonNegativeNumber(
      environment.LOAD_MAX_QUEUE_AGE_SECONDS,
      0,
      "LOAD_MAX_QUEUE_AGE_SECONDS",
    ),
    maxFinalQueueDepth:
      environment.LOAD_MAX_FINAL_QUEUE_DEPTH === undefined ||
      environment.LOAD_MAX_FINAL_QUEUE_DEPTH === ""
        ? null
        : maxFinalQueueDepth,
    metricsSampleIntervalMs: parsePositiveInteger(
      environment.LOAD_METRICS_SAMPLE_INTERVAL_MS,
      5_000,
      "LOAD_METRICS_SAMPLE_INTERVAL_MS",
      60_000,
    ),
    requireMetrics: environment.LOAD_REQUIRE_METRICS === "true",
    reviewFlow,
    metricsUrl,
    metricsToken,
    releaseIdentity,
  };
}

function parseReleaseIdentity(environment) {
  const required = environment.LOAD_REQUIRE_RELEASE_IDENTITY === "true";
  const values = {
    releaseGitSha: environment.LOAD_RELEASE_GIT_SHA?.trim() || "",
    applicationVersion:
      environment.LOAD_EXPECTED_APPLICATION_VERSION?.trim() || "",
    runtimeImageRef: environment.LOAD_RUNTIME_IMAGE_REF?.trim() || "",
    webImageRef: environment.LOAD_WEB_IMAGE_REF?.trim() || "",
    evidenceRepository: environment.GITHUB_REPOSITORY?.trim() || "",
    evidenceGitSha: environment.GITHUB_SHA?.trim() || "",
    evidenceGitRef: environment.GITHUB_REF?.trim() || "",
    evidenceRunId: environment.GITHUB_RUN_ID?.trim() || "",
  };
  const configured = [
    values.releaseGitSha,
    values.applicationVersion,
    values.runtimeImageRef,
    values.webImageRef,
  ].some(Boolean);
  if (!required && !configured) return null;

  for (const [key, value] of Object.entries(values)) {
    if (!value) {
      throw new Error(
        `${environmentNameByReleaseIdentityKey[key]} is required with release-bound load evidence.`,
      );
    }
  }
  if (!/^[a-f0-9]{40}$/u.test(values.releaseGitSha)) {
    throw new Error("LOAD_RELEASE_GIT_SHA must be an exact lowercase Git SHA.");
  }
  if (!/^[a-f0-9]{40}$/u.test(values.evidenceGitSha)) {
    throw new Error("GITHUB_SHA must be an exact lowercase Git SHA.");
  }
  for (const key of ["runtimeImageRef", "webImageRef"]) {
    if (!/^.+@sha256:[a-f0-9]{64}$/u.test(values[key])) {
      throw new Error(
        `${environmentNameByReleaseIdentityKey[key]} must be pinned by sha256 digest.`,
      );
    }
  }
  if (!/^\d+$/u.test(values.evidenceRunId)) {
    throw new Error("GITHUB_RUN_ID must be numeric.");
  }
  if (!values.evidenceRepository.includes("/")) {
    throw new Error("GITHUB_REPOSITORY must use the owner/repository form.");
  }
  if (!values.evidenceGitRef.startsWith("refs/")) {
    throw new Error("GITHUB_REF must be an exact refs/* identity.");
  }

  return values;
}

const environmentNameByReleaseIdentityKey = {
  releaseGitSha: "LOAD_RELEASE_GIT_SHA",
  applicationVersion: "LOAD_EXPECTED_APPLICATION_VERSION",
  runtimeImageRef: "LOAD_RUNTIME_IMAGE_REF",
  webImageRef: "LOAD_WEB_IMAGE_REF",
  evidenceRepository: "GITHUB_REPOSITORY",
  evidenceGitSha: "GITHUB_SHA",
  evidenceGitRef: "GITHUB_REF",
  evidenceRunId: "GITHUB_RUN_ID",
};
