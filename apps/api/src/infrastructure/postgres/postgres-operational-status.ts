import type { Pool } from "pg";
import type {
  OperationalStatusProvider,
  OperationalStatusSnapshot,
  QueueStatus,
  WorkerStatus,
} from "../../observability/operational-status.js";
import { jobDurationBuckets } from "../../observability/operational-status.js";
import { toIso } from "./database.js";

interface WorkerRow {
  instance_id: string;
  worker_type: WorkerStatus["workerType"];
  release_version: string;
  concurrency: number;
  resident_memory_bytes: string | number;
  heap_used_bytes: string | number;
  cpu_user_microseconds: string | number;
  cpu_system_microseconds: string | number;
  last_seen_at: Date | string;
  stale: boolean;
}

interface QueueRow {
  queue: QueueStatus["queue"];
  queued: string | number;
  active: string | number;
  failed: string | number;
  oldest_queued_seconds: string | number | null;
}

interface RecentWorkerEventRow {
  worker_type: WorkerStatus["workerType"];
  event_type: "completed" | "retry" | "failed" | "lease_lost";
  count: string | number;
}

interface WorkerDurationMetricRow {
  worker_type: WorkerStatus["workerType"];
  completed_count: string | number;
  duration_sum_ms: string | number | null;
  duration_buckets: Array<string | number>;
}

interface MaintenanceRow {
  task: "retention";
  last_started_at: Date | string | null;
  last_succeeded_at: Date | string | null;
  last_failed_at: Date | string | null;
  last_error: string | null;
  stale: boolean;
}

interface EmailOutboxRow {
  queued: string | number;
  sending: string | number;
  failed: string | number;
  oldest_queued_seconds: string | number | null;
  retries_last_hour: string | number;
  failures_last_hour: string | number;
}

export class PostgresOperationalStatusProvider
  implements OperationalStatusProvider
{
  constructor(
    private readonly pool: Pool,
    private readonly options: {
      characterWorkerExpected?: boolean;
      securityWorkerExpected?: boolean;
    } = {},
  ) {}

  async snapshot(): Promise<OperationalStatusSnapshot> {
    const [
      workers,
      queues,
      recentWorkerEvents,
      durationMetrics,
      maintenance,
      emailOutbox,
    ] = await Promise.all([
        this.pool.query<WorkerRow>(
          `SELECT
           instance_id, worker_type, release_version, concurrency,
           resident_memory_bytes, heap_used_bytes,
           cpu_user_microseconds, cpu_system_microseconds,
           last_seen_at,
           last_seen_at < now() - interval '45 seconds' AS stale
         FROM worker_heartbeats
         WHERE last_seen_at > now() - interval '7 days'
         ORDER BY worker_type, instance_id`,
        ),
        this.pool.query<QueueRow>(
          `SELECT
           CASE project_kind
             WHEN 'image' THEN 'processing-media'
             ELSE 'processing-document'
           END AS queue,
           count(*) FILTER (WHERE status = 'queued') AS queued,
           count(*) FILTER (
             WHERE status IN ('processing', 'verifying')
           ) AS active,
           count(*) FILTER (WHERE status = 'failed') AS failed,
           COALESCE(
             extract(epoch FROM now() - min(created_at) FILTER (
               WHERE status = 'queued'
             )),
             0
           ) AS oldest_queued_seconds
         FROM processing_jobs
         GROUP BY project_kind
         UNION ALL
         SELECT
           'export' AS queue,
           count(*) FILTER (WHERE status = 'queued') AS queued,
           count(*) FILTER (
             WHERE status IN ('generating', 'verifying')
           ) AS active,
           count(*) FILTER (WHERE status = 'failed') AS failed,
           COALESCE(
             extract(epoch FROM now() - min(created_at) FILTER (
               WHERE status = 'queued'
             )),
             0
           ) AS oldest_queued_seconds
         FROM export_jobs
         ${this.options.securityWorkerExpected ? malwareScanQueueUnion : ""}
         ${this.options.characterWorkerExpected ? characterQueueUnion : ""}`,
        ),
        this.pool.query<RecentWorkerEventRow>(
          `SELECT
           worker_type,
           event_type,
           count(*) AS count
         FROM worker_events
         WHERE created_at > now() - interval '1 hour'
         GROUP BY worker_type, event_type`,
        ),
        this.pool.query<WorkerDurationMetricRow>(
          `SELECT
           worker_type,
           completed_count,
           duration_sum_ms,
           ARRAY[
             duration_le_1s,
             duration_le_5s,
             duration_le_15s,
             duration_le_30s,
             duration_le_60s,
             duration_le_120s,
             duration_le_300s,
             duration_le_600s
           ] AS duration_buckets
         FROM worker_duration_metrics`,
        ),
        this.pool.query<MaintenanceRow>(
          `SELECT
             task, last_started_at, last_succeeded_at, last_failed_at,
             last_error,
             stale_after_at IS NULL OR stale_after_at < now() AS stale
           FROM maintenance_status
           WHERE task = 'retention'`,
        ),
        this.pool.query<EmailOutboxRow>(
          `SELECT
             count(*) FILTER (WHERE status = 'queued') AS queued,
             count(*) FILTER (WHERE status = 'sending') AS sending,
             count(*) FILTER (WHERE status = 'failed') AS failed,
             COALESCE(
               extract(epoch FROM now() - min(created_at) FILTER (
                 WHERE status IN ('queued', 'sending')
               )),
               0
             ) AS oldest_queued_seconds,
             count(*) FILTER (
               WHERE attempt > 1
                 AND updated_at > now() - interval '1 hour'
             ) AS retries_last_hour,
             count(*) FILTER (
               WHERE status = 'failed'
                 AND updated_at > now() - interval '1 hour'
             ) AS failures_last_hour
           FROM email_outbox`,
        ),
      ]);
    const mappedWorkers = workers.rows.map((row): WorkerStatus => ({
      instanceId: row.instance_id,
      workerType: row.worker_type,
      releaseVersion: row.release_version,
      concurrency: row.concurrency,
      residentMemoryBytes: Number(row.resident_memory_bytes),
      heapUsedBytes: Number(row.heap_used_bytes),
      cpuUserSeconds: Number(row.cpu_user_microseconds) / 1_000_000,
      cpuSystemSeconds: Number(row.cpu_system_microseconds) / 1_000_000,
      lastSeenAt: toIso(row.last_seen_at),
      stale: row.stale,
    }));
    const mappedQueues = queues.rows.map((row): QueueStatus => {
      const workerType =
        row.queue === "processing-media"
          ? "media"
          : row.queue === "processing-document"
            ? "document"
            : row.queue === "export"
              ? "export"
              : row.queue === "malware-scan"
                ? "security"
                : "character";
      const event = (type: RecentWorkerEventRow["event_type"]) =>
        recentWorkerEvents.rows.find(
          (candidate) =>
            candidate.worker_type === workerType &&
            candidate.event_type === type,
        );
      const completed = durationMetrics.rows.find(
        (candidate) => candidate.worker_type === workerType,
      );
      return {
        queue: row.queue,
        queued: Number(row.queued),
        active: Number(row.active),
        failed: Number(row.failed),
        oldestQueuedSeconds: Math.max(
          0,
          Number(row.oldest_queued_seconds ?? 0),
        ),
        retriesLastHour: Number(event("retry")?.count ?? 0),
        failuresLastHour: Number(event("failed")?.count ?? 0),
        completionsLastHour: Number(event("completed")?.count ?? 0),
        leaseLossesLastHour: Number(event("lease_lost")?.count ?? 0),
        duration: {
          count: Number(completed?.completed_count ?? 0),
          sumSeconds: Number(completed?.duration_sum_ms ?? 0) / 1_000,
          buckets: jobDurationBuckets.map(
            (_bucket, index) =>
              Number(completed?.duration_buckets[index] ?? 0),
          ),
        },
      };
    });
    const requiredWorkerTypes = new Set<WorkerStatus["workerType"]>([
      "media",
      "document",
      "export",
      ...(this.options.securityWorkerExpected ? (["security"] as const) : []),
      ...(this.options.characterWorkerExpected ? (["character"] as const) : []),
    ]);
    const expectedWorkerTypes = new Set(requiredWorkerTypes);
    for (const worker of mappedWorkers) {
      if (!worker.stale) expectedWorkerTypes.delete(worker.workerType);
    }
    const maintenanceRow = maintenance.rows[0];
    const mappedMaintenance = maintenanceRow
      ? {
          task: maintenanceRow.task,
          lastStartedAt: optionalIso(maintenanceRow.last_started_at),
          lastSucceededAt: optionalIso(maintenanceRow.last_succeeded_at),
          lastFailedAt: optionalIso(maintenanceRow.last_failed_at),
          lastError: maintenanceRow.last_error,
          stale: maintenanceRow.stale,
        }
      : null;
    const emailOutboxRow = emailOutbox.rows[0];
    const mappedEmailOutbox = emailOutboxRow
      ? {
          queued: Number(emailOutboxRow.queued),
          sending: Number(emailOutboxRow.sending),
          failed: Number(emailOutboxRow.failed),
          oldestQueuedSeconds: Math.max(
            0,
            Number(emailOutboxRow.oldest_queued_seconds ?? 0),
          ),
          retriesLastHour: Number(emailOutboxRow.retries_last_hour),
          failuresLastHour: Number(emailOutboxRow.failures_last_hour),
        }
      : null;
    return {
      status:
        mappedWorkers.some(
          (worker) =>
            worker.stale && requiredWorkerTypes.has(worker.workerType),
        ) ||
        expectedWorkerTypes.size > 0 ||
        !mappedMaintenance ||
        mappedMaintenance.stale
          ? "degraded"
          : "ready",
      workers: mappedWorkers,
      queues: mappedQueues,
      emailOutbox: mappedEmailOutbox,
      maintenance: mappedMaintenance,
      checkedAt: new Date().toISOString(),
    };
  }
}

const characterQueueUnion = `
  UNION ALL
  SELECT
    'character' AS queue,
    count(*) FILTER (WHERE status = 'queued') AS queued,
    count(*) FILTER (WHERE status IN ('processing', 'verifying')) AS active,
    count(*) FILTER (WHERE status = 'failed') AS failed,
    COALESCE(
      extract(epoch FROM now() - min(created_at) FILTER (
        WHERE status = 'queued'
      )),
      0
    ) AS oldest_queued_seconds
  FROM character_jobs
`;

const malwareScanQueueUnion = `
  UNION ALL
  SELECT
    'malware-scan' AS queue,
    count(*) FILTER (WHERE status IN ('queued', 'retry_wait')) AS queued,
    count(*) FILTER (WHERE status = 'scanning') AS active,
    count(*) FILTER (WHERE status IN ('malicious', 'failed')) AS failed,
    COALESCE(
      extract(epoch FROM now() - min(created_at) FILTER (
        WHERE status IN ('queued', 'retry_wait')
      )),
      0
    ) AS oldest_queued_seconds
  FROM malware_scan_jobs
`;

function optionalIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}
