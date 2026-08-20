import type { Pool } from "pg";

export type WorkerType =
  | "media"
  | "document"
  | "export"
  | "character"
  | "security";
export type WorkerEventType = "completed" | "retry" | "failed" | "lease_lost";

export async function recordWorkerEvent(
  pool: Pool,
  event: {
    workerType: WorkerType;
    eventType: WorkerEventType;
    jobId: string;
    durationMs?: number;
  },
): Promise<void> {
  await pool.query(
    `WITH recorded AS (
       INSERT INTO worker_events (
         worker_type, event_type, job_id, duration_ms
       )
       VALUES ($1, $2, $3, $4)
       RETURNING worker_type, event_type, duration_ms
     )
     INSERT INTO worker_duration_metrics (
       worker_type,
       completed_count,
       duration_sum_ms,
       duration_le_1s,
       duration_le_5s,
       duration_le_15s,
       duration_le_30s,
       duration_le_60s,
       duration_le_120s,
       duration_le_300s,
       duration_le_600s,
       updated_at
     )
     SELECT
       worker_type,
       1,
       duration_ms,
       (duration_ms <= 1000)::integer,
       (duration_ms <= 5000)::integer,
       (duration_ms <= 15000)::integer,
       (duration_ms <= 30000)::integer,
       (duration_ms <= 60000)::integer,
       (duration_ms <= 120000)::integer,
       (duration_ms <= 300000)::integer,
       (duration_ms <= 600000)::integer,
       now()
     FROM recorded
     WHERE event_type = 'completed' AND duration_ms IS NOT NULL
     ON CONFLICT (worker_type) DO UPDATE SET
       completed_count =
         worker_duration_metrics.completed_count + EXCLUDED.completed_count,
       duration_sum_ms =
         worker_duration_metrics.duration_sum_ms + EXCLUDED.duration_sum_ms,
       duration_le_1s =
         worker_duration_metrics.duration_le_1s + EXCLUDED.duration_le_1s,
       duration_le_5s =
         worker_duration_metrics.duration_le_5s + EXCLUDED.duration_le_5s,
       duration_le_15s =
         worker_duration_metrics.duration_le_15s + EXCLUDED.duration_le_15s,
       duration_le_30s =
         worker_duration_metrics.duration_le_30s + EXCLUDED.duration_le_30s,
       duration_le_60s =
         worker_duration_metrics.duration_le_60s + EXCLUDED.duration_le_60s,
       duration_le_120s =
         worker_duration_metrics.duration_le_120s + EXCLUDED.duration_le_120s,
       duration_le_300s =
         worker_duration_metrics.duration_le_300s + EXCLUDED.duration_le_300s,
       duration_le_600s =
         worker_duration_metrics.duration_le_600s + EXCLUDED.duration_le_600s,
       updated_at = now()`,
    [
      event.workerType,
      event.eventType,
      event.jobId,
      event.durationMs ?? null,
    ],
  );
}
