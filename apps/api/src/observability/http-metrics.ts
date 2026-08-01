import { timingSafeEqual } from "node:crypto";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { OperationalStatusProvider } from "./operational-status.js";
import { jobDurationBuckets } from "./operational-status.js";

const durationBuckets = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface HttpMetric {
  count: number;
  durationSeconds: number;
  buckets: number[];
}

export async function registerHttpMetrics(
  app: FastifyInstance,
  options: {
    bearerToken?: string;
    operationalStatus?: OperationalStatusProvider;
    readiness?: () => Promise<void>;
  } = {},
): Promise<void> {
  const startedAt = new WeakMap<FastifyRequest, bigint>();
  const metrics = new Map<string, HttpMetric>();

  app.addHook("onRequest", async (request) => {
    startedAt.set(request, process.hrtime.bigint());
  });
  app.addHook("onResponse", async (request, reply) => {
    const start = startedAt.get(request);
    if (start === undefined) return;
    const durationSeconds =
      Number(process.hrtime.bigint() - start) / 1_000_000_000;
    const route = request.routeOptions.url ?? "unmatched";
    const labels = metricLabels(request, reply, route);
    const current = metrics.get(labels) ?? {
      count: 0,
      durationSeconds: 0,
      buckets: durationBuckets.map(() => 0),
    };
    current.count += 1;
    current.durationSeconds += durationSeconds;
    durationBuckets.forEach((bucket, index) => {
      if (durationSeconds <= bucket) current.buckets[index]! += 1;
    });
    metrics.set(labels, current);
  });

  app.get(
    "/internal/metrics",
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
          groupId: "internal-metrics",
          // Keep this private, bearer-protected scrape observable while Redis
          // is the dependency being diagnosed.
          skipOnError: true,
        },
      },
    },
    async (request, reply) => {
    if (
      options.bearerToken &&
      !validBearerToken(request.headers.authorization, options.bearerToken)
    ) {
      return reply.status(401).send({
        data: null,
        error: {
          code: "METRICS_AUTH_REQUIRED",
          message: "Metrics authentication is required.",
          requestId: request.id,
        },
      });
    }
    const lines = renderHttpMetrics(metrics);
    if (options.operationalStatus) {
      try {
        const snapshot = await options.operationalStatus.snapshot();
        lines.push(
          "# HELP motionprep_operational_snapshot_success Whether operational metrics were collected.",
          "# TYPE motionprep_operational_snapshot_success gauge",
          "motionprep_operational_snapshot_success 1",
          "# HELP motionprep_queue_jobs Current jobs by queue and state.",
          "# TYPE motionprep_queue_jobs gauge",
          "# HELP motionprep_queue_oldest_queued_seconds Age of the oldest queued job.",
          "# TYPE motionprep_queue_oldest_queued_seconds gauge",
          "# HELP motionprep_worker_events_last_hour Recent retry and lease-loss events.",
          "# TYPE motionprep_worker_events_last_hour gauge",
          "# HELP motionprep_job_duration_seconds Cumulative completed-job duration histogram.",
          "# TYPE motionprep_job_duration_seconds histogram",
          "# HELP motionprep_worker_up Whether a required worker instance has a fresh heartbeat.",
          "# TYPE motionprep_worker_up gauge",
          "# HELP motionprep_maintenance_stale Whether scheduled maintenance is missing or overdue.",
          "# TYPE motionprep_maintenance_stale gauge",
          "# HELP motionprep_maintenance_last_success_timestamp_seconds Unix time of the latest successful maintenance run.",
          "# TYPE motionprep_maintenance_last_success_timestamp_seconds gauge",
          "# HELP motionprep_maintenance_last_failure_timestamp_seconds Unix time of the latest failed maintenance run.",
          "# TYPE motionprep_maintenance_last_failure_timestamp_seconds gauge",
        );
        for (const queue of snapshot.queues) {
          for (const [state, value] of [
            ["queued", queue.queued],
            ["active", queue.active],
            ["failed", queue.failed],
          ] as const) {
            lines.push(
              `motionprep_queue_jobs{queue="${escapeLabel(queue.queue)}",state="${state}"} ${value}`,
            );
          }
          lines.push(
            `motionprep_queue_oldest_queued_seconds{queue="${escapeLabel(queue.queue)}"} ${queue.oldestQueuedSeconds.toFixed(3)}`,
            `motionprep_worker_events_last_hour{queue="${escapeLabel(queue.queue)}",event="retry"} ${queue.retriesLastHour}`,
            `motionprep_worker_events_last_hour{queue="${escapeLabel(queue.queue)}",event="lease_lost"} ${queue.leaseLossesLastHour}`,
          );
          jobDurationBuckets.forEach((bucket, index) => {
            lines.push(
              `motionprep_job_duration_seconds_bucket{queue="${escapeLabel(queue.queue)}",le="${bucket}"} ${queue.duration.buckets[index] ?? 0}`,
            );
          });
          lines.push(
            `motionprep_job_duration_seconds_bucket{queue="${escapeLabel(queue.queue)}",le="+Inf"} ${queue.duration.count}`,
            `motionprep_job_duration_seconds_sum{queue="${escapeLabel(queue.queue)}"} ${queue.duration.sumSeconds.toFixed(3)}`,
            `motionprep_job_duration_seconds_count{queue="${escapeLabel(queue.queue)}"} ${queue.duration.count}`,
          );
        }
        const missingWorkerTypes = new Set(["media", "document", "export"]);
        for (const worker of snapshot.workers) {
          missingWorkerTypes.delete(worker.workerType);
          lines.push(
            `motionprep_worker_up{worker_type="${worker.workerType}",instance="${escapeLabel(worker.instanceId)}",release="${escapeLabel(worker.releaseVersion)}"} ${worker.stale ? 0 : 1}`,
          );
        }
        for (const workerType of missingWorkerTypes) {
          lines.push(
            `motionprep_worker_up{worker_type="${workerType}",instance="missing",release="unknown"} 0`,
          );
        }
        const maintenance = snapshot.maintenance;
        lines.push(
          `motionprep_maintenance_stale{task="retention"} ${!maintenance || maintenance.stale ? 1 : 0}`,
          `motionprep_maintenance_last_success_timestamp_seconds{task="retention"} ${timestampSeconds(maintenance?.lastSucceededAt)}`,
          `motionprep_maintenance_last_failure_timestamp_seconds{task="retention"} ${timestampSeconds(maintenance?.lastFailedAt)}`,
        );
      } catch {
        lines.push(
          "# HELP motionprep_operational_snapshot_success Whether operational metrics were collected.",
          "# TYPE motionprep_operational_snapshot_success gauge",
          "motionprep_operational_snapshot_success 0",
        );
      }
    }
    if (options.readiness) {
      try {
        await options.readiness();
        lines.push(
          "# HELP motionprep_dependencies_ready Whether all configured dependencies are ready.",
          "# TYPE motionprep_dependencies_ready gauge",
          "motionprep_dependencies_ready 1",
        );
      } catch {
        lines.push(
          "# HELP motionprep_dependencies_ready Whether all configured dependencies are ready.",
          "# TYPE motionprep_dependencies_ready gauge",
          "motionprep_dependencies_ready 0",
        );
      }
    }
    lines.push(
      "# HELP motionprep_process_uptime_seconds Process uptime.",
      "# TYPE motionprep_process_uptime_seconds gauge",
      `motionprep_process_uptime_seconds ${process.uptime().toFixed(3)}`,
    );
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    lines.push(
      "# HELP motionprep_process_resident_memory_bytes Resident memory used by the API process.",
      "# TYPE motionprep_process_resident_memory_bytes gauge",
      `motionprep_process_resident_memory_bytes ${memory.rss}`,
      "# HELP motionprep_process_heap_used_bytes JavaScript heap used by the API process.",
      "# TYPE motionprep_process_heap_used_bytes gauge",
      `motionprep_process_heap_used_bytes ${memory.heapUsed}`,
      "# HELP motionprep_process_cpu_seconds_total CPU time consumed by the API process.",
      "# TYPE motionprep_process_cpu_seconds_total counter",
      `motionprep_process_cpu_seconds_total{mode="user"} ${(cpu.user / 1_000_000).toFixed(6)}`,
      `motionprep_process_cpu_seconds_total{mode="system"} ${(cpu.system / 1_000_000).toFixed(6)}`,
    );
      return reply
        .type("text/plain; version=0.0.4; charset=utf-8")
        .send(`${lines.join("\n")}\n`);
    },
  );
}

function timestampSeconds(value: string | null | undefined): number {
  return value ? Math.floor(Date.parse(value) / 1_000) : 0;
}

function renderHttpMetrics(metrics: ReadonlyMap<string, HttpMetric>): string[] {
  const lines = [
    "# HELP motionprep_http_requests_total Completed HTTP requests.",
    "# TYPE motionprep_http_requests_total counter",
  ];
  for (const [labels, metric] of [...metrics.entries()].sort()) {
    lines.push(`motionprep_http_requests_total{${labels}} ${metric.count}`);
  }
  lines.push(
    "# HELP motionprep_http_request_duration_seconds Request duration histogram.",
    "# TYPE motionprep_http_request_duration_seconds histogram",
  );
  for (const [labels, metric] of [...metrics.entries()].sort()) {
    durationBuckets.forEach((bucket, index) => {
      lines.push(
        `motionprep_http_request_duration_seconds_bucket{${labels},le="${bucket}"} ${metric.buckets[index]}`,
      );
    });
    lines.push(
      `motionprep_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${metric.count}`,
      `motionprep_http_request_duration_seconds_sum{${labels}} ${metric.durationSeconds.toFixed(6)}`,
      `motionprep_http_request_duration_seconds_count{${labels}} ${metric.count}`,
    );
  }
  return lines;
}

function validBearerToken(
  authorization: string | undefined,
  expected: string,
): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const received = Buffer.from(authorization.slice(7));
  const target = Buffer.from(expected);
  return received.length === target.length && timingSafeEqual(received, target);
}

function metricLabels(
  request: FastifyRequest,
  reply: FastifyReply,
  route: string,
): string {
  return [
    `method="${escapeLabel(request.method)}"`,
    `route="${escapeLabel(route)}"`,
    `status="${reply.statusCode}"`,
  ].join(",");
}

function escapeLabel(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll('"', '\\"');
}
