import assert from "node:assert/strict";
import test from "node:test";
import { loadPdfConfiguration } from "./load-pdf-config.mjs";

const protectedPolicy = {
  LOAD_TARGET_ORIGIN: "https://staging.example.test",
  LOAD_EXPECTED_HOST: "staging.example.test",
  LOAD_CONCURRENCY: "4",
  LOAD_ITERATIONS: "3",
  LOAD_MIN_CONCURRENCY: "4",
  LOAD_MIN_TOTAL_JOURNEYS: "12",
  LOAD_REQUIRE_METRICS: "true",
  LOAD_METRICS_URL: "https://metrics.example.test/internal/metrics",
  LOAD_METRICS_BEARER_TOKEN: "protected-token",
  LOAD_MAX_FINAL_QUEUE_DEPTH: "0",
};

const releasePolicy = {
  LOAD_REQUIRE_RELEASE_IDENTITY: "true",
  LOAD_RELEASE_GIT_SHA: "a".repeat(40),
  LOAD_EXPECTED_APPLICATION_VERSION: "0.1.3",
  LOAD_RUNTIME_IMAGE_REF: `ghcr.io/example/runtime@sha256:${"b".repeat(64)}`,
  LOAD_WEB_IMAGE_REF: `ghcr.io/example/web@sha256:${"c".repeat(64)}`,
  GITHUB_REPOSITORY: "example/motionprep",
  GITHUB_SHA: "d".repeat(40),
  GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_ID: "12345",
};

test("accepts a representative sustained-load policy", () => {
  const config = loadPdfConfiguration(protectedPolicy);

  assert.equal(config.concurrency, 4);
  assert.equal(config.accountPoolSize, 4);
  assert.equal(config.iterationsPerUser, 3);
  assert.equal(config.minTotalJourneys, 12);
  assert.equal(config.maxFinalQueueDepth, 0);
  assert.equal(config.requireMetrics, true);
  assert.equal(config.reviewFlow, "approval-required");
});

test("supports the twenty-client upload capacity gate", () => {
  const config = loadPdfConfiguration({
    ...protectedPolicy,
    LOAD_CONCURRENCY: "20",
    LOAD_ITERATIONS: "1",
    LOAD_MIN_CONCURRENCY: "20",
    LOAD_MIN_TOTAL_JOURNEYS: "20",
  });

  assert.equal(config.concurrency, 20);
  assert.equal(config.accountPoolSize, 10);
  assert.equal(config.minTotalJourneys, 20);
  assert.throws(
    () =>
      loadPdfConfiguration({
        ...protectedPolicy,
        LOAD_CONCURRENCY: "33",
      }),
    /LOAD_CONCURRENCY/u,
  );
  assert.throws(
    () =>
      loadPdfConfiguration({
        ...protectedPolicy,
        LOAD_CONCURRENCY: "4",
        LOAD_ACCOUNT_POOL_SIZE: "5",
      }),
    /LOAD_ACCOUNT_POOL_SIZE/u,
  );
});

test("supports the pre-approval journey only when explicitly selected", () => {
  assert.equal(
    loadPdfConfiguration({
      ...protectedPolicy,
      LOAD_REVIEW_FLOW: "pre-approval",
    }).reviewFlow,
    "pre-approval",
  );
  assert.throws(
    () =>
      loadPdfConfiguration({
        ...protectedPolicy,
        LOAD_REVIEW_FLOW: "automatic",
      }),
    /LOAD_REVIEW_FLOW/u,
  );
});

test("rejects smoke-sized runs when the protected policy requires load", () => {
  assert.throws(
    () =>
      loadPdfConfiguration({
        ...protectedPolicy,
        LOAD_CONCURRENCY: "2",
      }),
    /at least LOAD_MIN_CONCURRENCY/u,
  );
  assert.throws(
    () =>
      loadPdfConfiguration({
        ...protectedPolicy,
        LOAD_ITERATIONS: "1",
      }),
    /at least 12 total journeys/u,
  );
});

test("requires paired protected metrics coordinates", () => {
  assert.throws(
    () =>
      loadPdfConfiguration({
        ...protectedPolicy,
        LOAD_METRICS_BEARER_TOKEN: "",
      }),
    /configured together/u,
  );
});

test("binds protected load evidence to release and workflow provenance", () => {
  const config = loadPdfConfiguration({
    ...protectedPolicy,
    ...releasePolicy,
  });

  assert.equal(config.releaseIdentity.releaseGitSha, releasePolicy.LOAD_RELEASE_GIT_SHA);
  assert.equal(config.releaseIdentity.evidenceGitSha, releasePolicy.GITHUB_SHA);
  assert.equal(config.releaseIdentity.evidenceRunId, releasePolicy.GITHUB_RUN_ID);
});

test("rejects incomplete or mutable release-bound evidence", () => {
  assert.throws(
    () =>
      loadPdfConfiguration({
        ...protectedPolicy,
        ...releasePolicy,
        LOAD_WEB_IMAGE_REF: "ghcr.io/example/web:latest",
      }),
    /sha256 digest/u,
  );
  assert.throws(
    () =>
      loadPdfConfiguration({
        ...protectedPolicy,
        ...releasePolicy,
        GITHUB_RUN_ID: "",
      }),
    /GITHUB_RUN_ID is required/u,
  );
});

test("does not bind ordinary CI smoke runs from ambient GitHub metadata alone", () => {
  const config = loadPdfConfiguration({
    ...protectedPolicy,
    GITHUB_REPOSITORY: "example/motionprep",
    GITHUB_SHA: "d".repeat(40),
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ID: "12345",
  });

  assert.equal(config.releaseIdentity, null);
});
