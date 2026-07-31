CREATE TABLE IF NOT EXISTS worker_duration_metrics (
  worker_type text PRIMARY KEY CHECK (
    worker_type IN ('media', 'document', 'export')
  ),
  completed_count bigint NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  duration_sum_ms numeric(24, 0) NOT NULL DEFAULT 0 CHECK (
    duration_sum_ms >= 0
  ),
  duration_le_1s bigint NOT NULL DEFAULT 0 CHECK (duration_le_1s >= 0),
  duration_le_5s bigint NOT NULL DEFAULT 0 CHECK (duration_le_5s >= 0),
  duration_le_15s bigint NOT NULL DEFAULT 0 CHECK (duration_le_15s >= 0),
  duration_le_30s bigint NOT NULL DEFAULT 0 CHECK (duration_le_30s >= 0),
  duration_le_60s bigint NOT NULL DEFAULT 0 CHECK (duration_le_60s >= 0),
  duration_le_120s bigint NOT NULL DEFAULT 0 CHECK (duration_le_120s >= 0),
  duration_le_300s bigint NOT NULL DEFAULT 0 CHECK (duration_le_300s >= 0),
  duration_le_600s bigint NOT NULL DEFAULT 0 CHECK (duration_le_600s >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
