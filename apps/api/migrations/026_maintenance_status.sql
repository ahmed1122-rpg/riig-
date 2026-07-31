CREATE TABLE IF NOT EXISTS maintenance_status (
  task text PRIMARY KEY,
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  last_error text,
  stale_after_at timestamptz
);
