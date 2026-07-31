ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_secret_ciphertext text,
  ADD COLUMN IF NOT EXISTS recovery_code_hashes text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS mfa_enrollments (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret_ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS mfa_enrollments_expires_idx
  ON mfa_enrollments(expires_at);

CREATE TABLE IF NOT EXISTS mfa_challenges (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS mfa_challenges_expires_idx
  ON mfa_challenges(expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_idx
  ON password_reset_tokens(expires_at);
