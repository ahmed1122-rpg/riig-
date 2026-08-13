type ProjectAlias = "project" | "projects";
type TimestampExpression = "now()" | "$2" | "$4";

/**
 * Shared SQL predicate for reserving project work. The narrow unions keep every
 * interpolated token internal and prevent request data from entering SQL text.
 */
export function availableProjectWorkFenceSql(
  projectAlias: ProjectAlias,
  timestampExpression: TimestampExpression,
): string {
  return `AND ${projectAlias}.active_job_id IS NULL
    AND ${projectAlias}.status NOT IN ('validating', 'uploading')
    AND NOT EXISTS (
      SELECT 1 FROM upload_sessions AS active_upload
      WHERE active_upload.project_id = ${projectAlias}.id
        AND active_upload.status IN ('validating', 'uploading', 'verifying')
        AND active_upload.expires_at > ${timestampExpression}
    )`;
}
