ALTER TABLE upload_sessions
  ADD COLUMN IF NOT EXISTS project_status_before_upload text;

ALTER TABLE upload_sessions
  DROP CONSTRAINT IF EXISTS upload_sessions_project_status_before_upload_check;
ALTER TABLE upload_sessions
  ADD CONSTRAINT upload_sessions_project_status_before_upload_check
  CHECK (
    project_status_before_upload IS NULL
    OR project_status_before_upload IN (
      'draft', 'validating', 'uploading', 'queued', 'processing',
      'needs_review', 'approved', 'exporting', 'completed', 'failed',
      'cancelled'
    )
  );

CREATE INDEX IF NOT EXISTS upload_sessions_cancel_cleanup_idx
  ON upload_sessions(project_id, updated_at, upload_id)
  WHERE status = 'cancelled' AND object_purged_at IS NULL;
