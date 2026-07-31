CREATE TABLE IF NOT EXISTS idempotency_keys (
  namespace text NOT NULL,
  idempotency_key text NOT NULL,
  resource_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_expires_at_idx
  ON idempotency_keys(expires_at);
