CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  role text NOT NULL CHECK (role IN ('creator', 'support', 'finance', 'admin')),
  status text NOT NULL CHECK (
    status IN ('active', 'suspended', 'pending_verification')
  ),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('image', 'book')),
  status text NOT NULL CHECK (
    status IN (
      'draft', 'validating', 'uploading', 'queued', 'processing',
      'needs_review', 'approved', 'exporting', 'completed', 'failed',
      'cancelled'
    )
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_owner_updated_idx
  ON projects(owner_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS upload_sessions (
  upload_id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename text NOT NULL,
  content_type text NOT NULL CHECK (
    content_type IN ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')
  ),
  expected_size_bytes integer NOT NULL CHECK (
    expected_size_bytes > 0 AND expected_size_bytes <= 31457280
  ),
  status text NOT NULL CHECK (
    status IN (
      'validating', 'uploading', 'verifying', 'ready', 'failed', 'cancelled'
    )
  ),
  source_version_id uuid,
  sha256 char(64),
  object_key text NOT NULL,
  expires_at timestamptz NOT NULL,
  max_bytes integer NOT NULL CHECK (max_bytes = 31457280),
  demo_upload_url text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS upload_sessions_one_active_per_project_idx
  ON upload_sessions(project_id)
  WHERE status IN ('validating', 'uploading', 'verifying');
CREATE INDEX IF NOT EXISTS upload_sessions_ready_hash_idx
  ON upload_sessions(project_id, sha256)
  WHERE status = 'ready';

CREATE TABLE IF NOT EXISTS export_jobs (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_version_id uuid NOT NULL,
  format text NOT NULL CHECK (
    format IN (
      'psd', 'png-layers-json', 'layered-tiff', 'transparent-pngs',
      'txt', 'csv', 'json'
    )
  ),
  scope text NOT NULL CHECK (
    scope IN ('full-document', 'per-page', 'selected-page')
  ),
  status text NOT NULL CHECK (
    status IN (
      'preflight', 'queued', 'generating', 'verifying', 'ready', 'failed',
      'cancelled'
    )
  ),
  progress integer NOT NULL CHECK (progress BETWEEN 0 AND 100),
  artifact jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS export_jobs_project_created_idx
  ON export_jobs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan_id text NOT NULL CHECK (plan_id IN ('starter', 'creator', 'studio')),
  status text NOT NULL CHECK (
    status IN ('trialing', 'active', 'past_due', 'cancelled')
  ),
  renewal_at timestamptz NOT NULL,
  usage jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS checkout_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (
    provider IN ('sandbox-card', 'sandbox-local')
  ),
  plan_id text NOT NULL CHECK (plan_id IN ('starter', 'creator', 'studio')),
  status text NOT NULL CHECK (
    status IN (
      'pending', 'redirect_required', 'paid', 'failed', 'cancelled'
    )
  ),
  currency char(3) NOT NULL CHECK (currency IN ('USD', 'EGP')),
  amount_minor integer NOT NULL CHECK (amount_minor >= 0),
  checkout_url text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS checkout_sessions_user_created_idx
  ON checkout_sessions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success', 'denied', 'failed')),
  reason text,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_created_idx
  ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_created_idx
  ON audit_events(actor_user_id, created_at DESC);

