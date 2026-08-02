import assert from "node:assert/strict";
import test from "node:test";
import {
  growthFromBaseline,
  isCompleteMetricsSample,
  readLoadMetrics,
  summarizeMetricPeaks,
} from "./load-test-metrics.mjs";

const complete = {
  apiResidentMemoryBytes: 100,
  apiHeapUsedBytes: 50,
  apiCpuSeconds: 2,
  workerResidentMemoryBytes: 300,
  workerHeapUsedBytes: 150,
  workerCpuSeconds: 6,
  queueDepth: 2,
  oldestQueuedSeconds: 5,
};

test("summarizes complete API, worker, and queue metrics", () => {
  assert.equal(isCompleteMetricsSample(complete), true);
  assert.equal(
    isCompleteMetricsSample({ ...complete, workerCpuSeconds: undefined }),
    false,
  );
  assert.deepEqual(
    summarizeMetricPeaks([
      complete,
      {
        ...complete,
        apiResidentMemoryBytes: 140,
        workerResidentMemoryBytes: 360,
        queueDepth: 8,
      },
    ]),
    {
      apiResidentMemoryBytes: 140,
      apiHeapUsedBytes: 50,
      apiCpuSeconds: 2,
      workerResidentMemoryBytes: 360,
      workerHeapUsedBytes: 150,
      workerCpuSeconds: 6,
      queueDepth: 8,
      oldestQueuedSeconds: 5,
    },
  );
  assert.equal(growthFromBaseline(100, 140), 40);
});

test("parses worker resource totals from the protected scrape", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      [
        "motionprep_process_resident_memory_bytes 100",
        "motionprep_process_heap_used_bytes 50",
        'motionprep_process_cpu_seconds_total{mode="user"} 2',
        'motionprep_process_cpu_seconds_total{mode="system"} 1',
        'motionprep_worker_resident_memory_bytes{worker_type="media"} 200',
        'motionprep_worker_resident_memory_bytes{worker_type="export"} 300',
        'motionprep_worker_heap_used_bytes{worker_type="media"} 80',
        'motionprep_worker_heap_used_bytes{worker_type="export"} 120',
        'motionprep_worker_cpu_seconds_total{worker_type="media",mode="user"} 3',
        'motionprep_worker_cpu_seconds_total{worker_type="export",mode="user"} 4',
        'motionprep_queue_jobs{queue="export",state="queued"} 2',
        'motionprep_queue_oldest_queued_seconds{queue="export"} 6',
      ].join("\n"),
      { status: 200 },
    );
  try {
    const metrics = await readLoadMetrics({
      metricsUrl: "https://metrics.example.test/internal/metrics",
      metricsToken: "token",
      requestTimeoutMs: 1_000,
    });
    assert.deepEqual(metrics, {
      apiResidentMemoryBytes: 100,
      apiHeapUsedBytes: 50,
      apiCpuSeconds: 3,
      workerResidentMemoryBytes: 500,
      workerHeapUsedBytes: 200,
      workerCpuSeconds: 7,
      queueDepth: 2,
      oldestQueuedSeconds: 6,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
