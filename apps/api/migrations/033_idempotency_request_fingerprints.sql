ALTER TABLE idempotency_keys
  ADD COLUMN IF NOT EXISTS request_hash char(64);

ALTER TABLE idempotency_keys
  DROP CONSTRAINT IF EXISTS idempotency_keys_request_hash_check;
ALTER TABLE idempotency_keys
  ADD CONSTRAINT idempotency_keys_request_hash_check CHECK (
    request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$'
  );
