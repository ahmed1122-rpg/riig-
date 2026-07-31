CREATE TABLE IF NOT EXISTS worker_heartbeats (
  instance_id text PRIMARY KEY,
  worker_type text NOT NULL CHECK (
    worker_type IN ('media', 'document', 'export')
  ),
  release_version text NOT NULL,
  concurrency integer NOT NULL CHECK (concurrency > 0),
  started_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS worker_heartbeats_type_seen_idx
  ON worker_heartbeats(worker_type, last_seen_at DESC);
