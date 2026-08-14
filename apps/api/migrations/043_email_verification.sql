CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_verification_tokens_user_idx
  ON email_verification_tokens (user_id);

CREATE INDEX IF NOT EXISTS email_verification_tokens_expires_idx
  ON email_verification_tokens (expires_at);

ALTER TABLE email_outbox
  DROP CONSTRAINT IF EXISTS email_outbox_kind_check;

ALTER TABLE email_outbox
  ADD CONSTRAINT email_outbox_kind_check
  CHECK (kind IN ('password-reset', 'email-verification'));

ALTER TABLE email_outbox
  RENAME COLUMN reset_url TO action_url;
