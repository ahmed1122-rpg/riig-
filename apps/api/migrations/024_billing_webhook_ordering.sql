ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS provider_event_created_at bigint,
  ADD COLUMN IF NOT EXISTS provider_event_id text;

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_provider_event_version_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_provider_event_version_check
  CHECK (
    (provider_event_created_at IS NULL AND provider_event_id IS NULL)
    OR
    (provider_event_created_at IS NOT NULL AND provider_event_id IS NOT NULL)
  );

COMMENT ON COLUMN subscriptions.provider_event_created_at IS
  'Provider webhook creation time (Unix seconds) used to reject stale updates.';

COMMENT ON COLUMN subscriptions.provider_event_id IS
  'Provider webhook id used as a deterministic tie-breaker within one second.';
