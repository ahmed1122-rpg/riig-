CREATE TABLE IF NOT EXISTS source_versions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  upload_id uuid NOT NULL UNIQUE,
  version_number integer NOT NULL CHECK (version_number > 0),
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (
    size_bytes > 0 AND size_bytes <= 31457280
  ),
  status text NOT NULL CHECK (
    status IN (
      'validating', 'uploading', 'verifying', 'ready', 'failed', 'cancelled'
    )
  ),
  sha256 char(64),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (project_id, version_number)
);
CREATE INDEX IF NOT EXISTS source_versions_project_created_idx
  ON source_versions(project_id, version_number DESC);

WITH distinct_sources AS (
  SELECT DISTINCT ON (project_id, source_version_id)
    source_version_id AS id,
    project_id,
    upload_id,
    filename,
    content_type,
    expected_size_bytes AS size_bytes,
    status,
    sha256,
    created_at,
    updated_at
  FROM upload_sessions
  WHERE source_version_id IS NOT NULL
  ORDER BY project_id, source_version_id, created_at
),
numbered_sources AS (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY project_id
      ORDER BY created_at, id
    ) AS version_number
  FROM distinct_sources
)
INSERT INTO source_versions (
  id, project_id, upload_id, version_number, filename, content_type,
  size_bytes, status, sha256, created_at, updated_at
)
SELECT
  id, project_id, upload_id, version_number, filename, content_type,
  size_bytes, status, sha256, created_at, updated_at
FROM numbered_sources
ON CONFLICT DO NOTHING;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS current_source_version_id uuid;

UPDATE projects AS project
SET current_source_version_id = latest.id
FROM (
  SELECT DISTINCT ON (project_id) project_id, id
  FROM source_versions
  WHERE status = 'ready'
  ORDER BY project_id, version_number DESC
) AS latest
WHERE project.id = latest.project_id
  AND project.current_source_version_id IS NULL;

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_current_source_version_id_fkey;
ALTER TABLE projects
  ADD CONSTRAINT projects_current_source_version_id_fkey
  FOREIGN KEY (current_source_version_id)
  REFERENCES source_versions(id)
  ON DELETE SET NULL;

-- Expand first: the preceding release continues to read/write
-- demo_upload_url while this release uses upload_url. Keep both columns until
-- every production instance runs a version that no longer needs the legacy
-- name; removal belongs in a later contract migration.
ALTER TABLE upload_sessions
  ADD COLUMN IF NOT EXISTS upload_url text;

UPDATE upload_sessions
SET upload_url = demo_upload_url
WHERE upload_url IS NULL;

CREATE OR REPLACE FUNCTION sync_upload_session_urls()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.upload_url := COALESCE(NEW.upload_url, NEW.demo_upload_url);
    NEW.demo_upload_url := COALESCE(NEW.demo_upload_url, NEW.upload_url);
  ELSIF NEW.upload_url IS DISTINCT FROM OLD.upload_url
    AND NEW.demo_upload_url IS NOT DISTINCT FROM OLD.demo_upload_url THEN
    NEW.demo_upload_url := NEW.upload_url;
  ELSIF NEW.demo_upload_url IS DISTINCT FROM OLD.demo_upload_url
    AND NEW.upload_url IS NOT DISTINCT FROM OLD.upload_url THEN
    NEW.upload_url := NEW.demo_upload_url;
  END IF;
  IF NEW.upload_url IS NULL OR NEW.demo_upload_url IS NULL THEN
    RAISE EXCEPTION 'upload URL columns must remain populated';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS upload_sessions_sync_urls ON upload_sessions;
CREATE TRIGGER upload_sessions_sync_urls
BEFORE INSERT OR UPDATE OF upload_url, demo_upload_url ON upload_sessions
FOR EACH ROW EXECUTE FUNCTION sync_upload_session_urls();

ALTER TABLE upload_sessions
  ALTER COLUMN upload_url SET NOT NULL;
