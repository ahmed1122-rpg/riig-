const exportColumns = `
  id, project_id, source_version_id, project_kind, format, scope,
  document_revision,
  selected_page, scale, color_profile, naming_preset_id, status, progress,
  attempt, max_attempts, next_attempt_at, lease_owner, lease_expires_at,
  error_code, artifact, correlation_id, trace_parent, trace_state, created_at, updated_at
`;

export const exportReturningColumns = `
  job.id, job.project_id, job.source_version_id, job.project_kind, job.format,
  job.scope, job.document_revision, job.selected_page, job.scale, job.color_profile,
  job.naming_preset_id, job.status, job.progress, job.attempt,
  job.max_attempts, job.next_attempt_at, job.lease_owner,
  job.lease_expires_at, job.error_code, job.artifact, job.correlation_id,
  job.trace_parent, job.trace_state, job.created_at, job.updated_at
`;

export const exportSelect = `SELECT ${exportColumns} FROM export_jobs`;
