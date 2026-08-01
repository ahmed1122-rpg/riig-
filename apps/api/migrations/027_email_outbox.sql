CREATE TABLE IF NOT EXISTS email_outbox (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('password-reset')),
  recipient text NOT NULL,
  reset_url text NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  next_attempt_at timestamptz NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  error_code text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_outbox_claim_idx
  ON email_outbox (next_attempt_at, created_at)
  WHERE status IN ('queued', 'sending');

CREATE INDEX IF NOT EXISTS email_outbox_retention_idx
  ON email_outbox (updated_at)
  WHERE status IN ('sent', 'failed');
