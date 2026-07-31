CREATE TABLE IF NOT EXISTS usage_ledger (
  id uuid PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  event_key text NOT NULL,
  jobs_delta integer NOT NULL DEFAULT 0,
  processing_seconds integer NOT NULL DEFAULT 0
    CHECK (processing_seconds >= 0),
  period_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, event_key)
);

CREATE INDEX IF NOT EXISTS usage_ledger_user_period_idx
  ON usage_ledger(user_id, period_end DESC);
