CREATE INDEX IF NOT EXISTS projects_current_source_version_idx
  ON projects(current_source_version_id)
  WHERE current_source_version_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS upload_sessions_source_version_idx
  ON upload_sessions(source_version_id)
  WHERE source_version_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS export_jobs_project_source_idx
  ON export_jobs(project_id, source_version_id);

CREATE INDEX IF NOT EXISTS source_restore_events_from_source_idx
  ON source_version_restore_events(from_source_version_id);

CREATE INDEX IF NOT EXISTS source_restore_events_to_source_idx
  ON source_version_restore_events(to_source_version_id);
