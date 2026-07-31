ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS provider text
    CHECK (provider IS NULL OR provider IN ('sandbox-card', 'sandbox-local', 'stripe')),
  ADD COLUMN IF NOT EXISTS provider_customer_id text,
  ADD COLUMN IF NOT EXISTS provider_subscription_id text,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_provider_subscription_idx
  ON subscriptions(provider, provider_subscription_id)
  WHERE provider IS NOT NULL AND provider_subscription_id IS NOT NULL;

ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS provider_reference text;

CREATE INDEX IF NOT EXISTS checkout_sessions_provider_reference_idx
  ON checkout_sessions(provider, provider_reference)
  WHERE provider_reference IS NOT NULL;
