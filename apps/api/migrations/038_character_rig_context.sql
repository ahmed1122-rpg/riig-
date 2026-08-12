CREATE TABLE IF NOT EXISTS character_bibles (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('draft', 'approved', 'retired')),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (project_id, version),
  UNIQUE (id, project_id),
  CHECK ((status = 'approved') = (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS character_bibles_project_updated_idx
  ON character_bibles(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS character_reference_assets (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bible_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN (
    'identity-primary', 'canonical-view', 'body-proportion', 'style-material',
    'part-mask', 'pose-control', 'depth-control'
  )),
  canonical_view text CHECK (canonical_view IS NULL OR canonical_view IN (
    'frontal', 'left-quarter', 'left-profile', 'right-quarter', 'right-profile'
  )),
  rights_classification text NOT NULL CHECK (rights_classification IN (
    'owned-by-user', 'licensed-for-model-use', 'user-provided-private-reference'
  )),
  artifact jsonb NOT NULL CHECK (jsonb_typeof(artifact) = 'object'),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  retention_expires_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (id, project_id),
  FOREIGN KEY (bible_id, project_id)
    REFERENCES character_bibles(id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS character_references_bible_role_idx
  ON character_reference_assets(bible_id, role, created_at);
CREATE INDEX IF NOT EXISTS character_references_retention_idx
  ON character_reference_assets(retention_expires_at)
  WHERE retention_expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS character_identity_model_versions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bible_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft', 'training', 'ready', 'failed', 'retired')),
  provider_key text NOT NULL CHECK (char_length(provider_key) BETWEEN 1 AND 80),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (bible_id, version),
  UNIQUE (id, project_id),
  FOREIGN KEY (bible_id, project_id)
    REFERENCES character_bibles(id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS character_models_project_status_idx
  ON character_identity_model_versions(project_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS character_generation_attempts (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bible_id uuid NOT NULL,
  identity_model_version_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN (
    'queued', 'processing', 'verifying', 'needs-review', 'approved',
    'rejected', 'failed', 'cancelled'
  )),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 160),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (project_id, idempotency_key),
  UNIQUE (id, project_id),
  FOREIGN KEY (bible_id, project_id)
    REFERENCES character_bibles(id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (identity_model_version_id, project_id)
    REFERENCES character_identity_model_versions(id, project_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS character_generations_project_status_idx
  ON character_generation_attempts(project_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS character_generation_reviews (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  generation_attempt_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected', 'changes-requested')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 2000),
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation_id text NOT NULL CHECK (char_length(operation_id) BETWEEN 8 AND 128),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (reviewer_user_id, operation_id),
  FOREIGN KEY (generation_attempt_id, project_id)
    REFERENCES character_generation_attempts(id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS character_reviews_attempt_created_idx
  ON character_generation_reviews(generation_attempt_id, created_at);

CREATE TABLE IF NOT EXISTS character_rig_versions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bible_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft', 'needs-review', 'approved', 'exported', 'retired')),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  approved_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (project_id, version),
  UNIQUE (id, project_id),
  FOREIGN KEY (bible_id, project_id)
    REFERENCES character_bibles(id, project_id) ON DELETE CASCADE,
  CHECK ((status IN ('approved', 'exported')) = (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS character_rigs_project_updated_idx
  ON character_rig_versions(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS character_jobs (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'train-identity', 'generate-view', 'generate-part', 'repair-part',
    'compile-rig', 'export-rig'
  )),
  status text NOT NULL CHECK (status IN (
    'queued', 'processing', 'verifying', 'succeeded', 'failed', 'cancelled'
  )),
  operation_key text NOT NULL CHECK (char_length(operation_key) BETWEEN 8 AND 160),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  attempt integer NOT NULL CHECK (attempt >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 10),
  next_attempt_at timestamptz NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (project_id, operation_key)
);

CREATE INDEX IF NOT EXISTS character_jobs_claim_idx
  ON character_jobs(status, next_attempt_at, created_at)
  WHERE status IN ('queued', 'processing', 'verifying');
CREATE UNIQUE INDEX IF NOT EXISTS character_jobs_one_active_operation_idx
  ON character_jobs(project_id, operation_key)
  WHERE status IN ('queued', 'processing', 'verifying');
