DROP INDEX IF EXISTS processing_jobs_source_active_idx;
CREATE UNIQUE INDEX processing_jobs_source_active_idx
  ON processing_jobs(project_id, source_version_id)
  WHERE status IN ('queued', 'processing', 'verifying');
