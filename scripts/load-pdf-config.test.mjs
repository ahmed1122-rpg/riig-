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

test("accepts a representative sustained-load policy", () => {
  const config = loadPdfConfiguration(protectedPolicy);

  assert.equal(config.concurrency, 4);
  assert.equal(config.iterationsPerUser, 3);
  assert.equal(config.minTotalJourneys, 12);
  assert.equal(config.maxFinalQueueDepth, 0);
  assert.equal(config.requireMetrics, true);
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
