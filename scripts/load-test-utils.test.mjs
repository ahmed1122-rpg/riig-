import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePositiveInteger,
  parseRate,
  percentile,
  prometheusMetricValues,
  runWithConcurrency,
  summarizeDurations,
} from "./load-test-utils.mjs";

test("selects Prometheus series by exact required labels", () => {
  const metrics = [
    'motionprep_queue_jobs{queue="processing-media",state="queued"} 2',
    'motionprep_queue_jobs{queue="processing-media",state="active"} 1',
    'motionprep_queue_jobs{queue="export",state="queued"} 3',
    "motionprep_process_resident_memory_bytes 4096",
  ].join("\n");
  assert.deepEqual(
    prometheusMetricValues(metrics, "motionprep_queue_jobs", { state: "queued" }),
    [2, 3],
  );
  assert.deepEqual(
    prometheusMetricValues(metrics, "motionprep_process_resident_memory_bytes"),
    [4096],
  );
});

test("uses nearest-rank latency percentiles", () => {
  assert.equal(percentile([40, 10, 30, 20], 0.5), 20);
  assert.equal(percentile([40, 10, 30, 20], 0.95), 40);
  assert.equal(percentile([], 0.95), 0);
});

test("summarizes each workflow stage independently", () => {
  assert.deepEqual(
    summarizeDurations([
      { stage: "upload", durationMs: 20 },
      { stage: "upload", durationMs: 10 },
      { stage: "export", durationMs: 50 },
    ]),
    {
      export: { count: 1, minMs: 50, p50Ms: 50, p95Ms: 50, p99Ms: 50, maxMs: 50 },
      upload: { count: 2, minMs: 10, p50Ms: 10, p95Ms: 20, p99Ms: 20, maxMs: 20 },
    },
  );
});

test("bounds load configuration and worker concurrency", async () => {
  assert.equal(parsePositiveInteger("4", 1, "LOAD_CONCURRENCY", 16), 4);
  assert.throws(
    () => parsePositiveInteger("0", 1, "LOAD_CONCURRENCY", 16),
    /between 1 and 16/u,
  );
  assert.equal(parseRate("0.05", 0, "LOAD_MAX_ERROR_RATE"), 0.05);
  assert.throws(
    () => parseRate("2", 0, "LOAD_MAX_ERROR_RATE"),
    /between 0 and 1/u,
  );
  let active = 0;
  let peak = 0;
  const results = await runWithConcurrency([1, 2, 3, 4], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8]);
  assert.equal(peak, 2);
});
