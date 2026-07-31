ALTER TABLE checkout_sessions
  DROP CONSTRAINT IF EXISTS checkout_sessions_provider_check;

ALTER TABLE checkout_sessions
  ADD CONSTRAINT checkout_sessions_provider_check
  CHECK (provider IN ('sandbox-card', 'sandbox-local', 'stripe'));
