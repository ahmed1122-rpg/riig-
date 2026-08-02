import { prometheusMetricValues } from "./load-test-utils.mjs";

export async function readLoadMetrics(config) {
  if (!config.metricsUrl || !config.metricsToken) return null;
  const response = await fetch(config.metricsUrl, {
    headers: { authorization: `Bearer ${config.metricsToken}` },
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Metrics endpoint returned ${response.status}.`);
  }
  const body = await response.text();
  const values = (name, labels) => prometheusMetricValues(body, name, labels);
  return {
    apiResidentMemoryBytes: values(
      "motionprep_process_resident_memory_bytes",
    )[0],
    apiHeapUsedBytes: values("motionprep_process_heap_used_bytes")[0],
    apiCpuSeconds: sum(values("motionprep_process_cpu_seconds_total")),
    workerResidentMemoryBytes: sum(
      values("motionprep_worker_resident_memory_bytes"),
    ),
    workerHeapUsedBytes: sum(values("motionprep_worker_heap_used_bytes")),
    workerCpuSeconds: sum(values("motionprep_worker_cpu_seconds_total")),
    queueDepth: sum(values("motionprep_queue_jobs", { state: "queued" })),
    oldestQueuedSeconds: maximum(
      values("motionprep_queue_oldest_queued_seconds"),
    ),
  };
}

export function withCaptureTime(sample, capturedAt) {
  return { capturedAt: capturedAt.toISOString(), ...sample };
}

export function isCompleteMetricsSample(sample) {
  return metricKeys.every((key) => Number.isFinite(sample[key]));
}

export function summarizeMetricPeaks(samples) {
  return Object.fromEntries(
    metricKeys.map((key) => [
      key,
      maximum(samples.map((sample) => sample[key]).filter(Number.isFinite)) ??
        null,
    ]),
  );
}

export function growthFromBaseline(baseline, peak) {
  return Number.isFinite(baseline) && Number.isFinite(peak)
    ? Math.max(0, peak - baseline)
    : null;
}

const metricKeys = [
  "apiResidentMemoryBytes",
  "apiHeapUsedBytes",
  "apiCpuSeconds",
  "workerResidentMemoryBytes",
  "workerHeapUsedBytes",
  "workerCpuSeconds",
  "queueDepth",
  "oldestQueuedSeconds",
];

function sum(values) {
  return values.length
    ? values.reduce((total, value) => total + value, 0)
    : undefined;
}

function maximum(values) {
  return values.length ? Math.max(...values) : undefined;
}
