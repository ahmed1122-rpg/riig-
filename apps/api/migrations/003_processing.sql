CREATE TABLE IF NOT EXISTS processing_jobs (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_version_id uuid NOT NULL,
  project_kind text NOT NULL CHECK (project_kind IN ('image', 'book')),
  status text NOT NULL CHECK (
    status IN (
      'queued', 'processing', 'verifying', 'ready', 'failed', 'cancelled'
    )
  ),
  progress integer NOT NULL CHECK (progress BETWEEN 0 AND 100),
  error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS processing_jobs_project_created_idx
  ON processing_jobs(project_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS processing_jobs_source_active_idx
  ON processing_jobs(project_id, source_version_id)
  WHERE status IN ('queued', 'processing', 'verifying', 'ready');

CREATE TABLE IF NOT EXISTS layer_documents (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_version_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, source_version_id)
);
CREATE INDEX IF NOT EXISTS layer_documents_project_updated_idx
  ON layer_documents(project_id, updated_at DESC);
