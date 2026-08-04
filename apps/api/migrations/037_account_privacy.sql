ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_version text,
  ADD COLUMN IF NOT EXISTS privacy_version text,
  ADD COLUMN IF NOT EXISTS legal_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('processing', 'failed', 'completed')),
  object_keys text[] NOT NULL DEFAULT '{}',
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  last_error text,
  requested_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS account_deletion_requests_pending_idx
  ON account_deletion_requests(updated_at, id)
  WHERE status IN ('processing', 'failed');

CREATE INDEX IF NOT EXISTS users_deletion_requested_idx
  ON users(deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL AND deleted_at IS NULL;
