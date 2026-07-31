CREATE TABLE IF NOT EXISTS worker_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  worker_type text NOT NULL CHECK (worker_type IN ('media', 'document', 'export')),
  event_type text NOT NULL CHECK (
    event_type IN ('completed', 'retry', 'failed', 'lease_lost')
  ),
  job_id uuid NOT NULL,
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS worker_events_type_created_idx
  ON worker_events(worker_type, event_type, created_at DESC);
