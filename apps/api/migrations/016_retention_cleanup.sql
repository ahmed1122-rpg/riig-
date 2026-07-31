ALTER TABLE upload_sessions
  ADD COLUMN IF NOT EXISTS object_purged_at timestamptz;

ALTER TABLE export_jobs
  ADD COLUMN IF NOT EXISTS artifact_purged_at timestamptz;

CREATE INDEX IF NOT EXISTS upload_sessions_cleanup_idx
  ON upload_sessions(expires_at, upload_id)
  WHERE object_purged_at IS NULL
    AND status <> 'ready';

CREATE INDEX IF NOT EXISTS export_jobs_artifact_cleanup_idx
  ON export_jobs((artifact->>'expiresAt'), id)
  WHERE artifact IS NOT NULL
    AND artifact_purged_at IS NULL
    AND status = 'ready';
