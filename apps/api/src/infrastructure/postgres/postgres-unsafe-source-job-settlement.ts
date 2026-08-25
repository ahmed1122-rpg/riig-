import type { PoolClient } from "pg";

export interface UnsafeSourceJobSettlement {
  projectId: string;
  sourceVersionId: string;
  errorCode: string;
  settledAt?: string;
}

/**
 * Makes work derived from an unsafe source terminal in the same transaction
 * that settles the source verdict. Ready artifacts remain as audit/retention
 * records, but the download path independently re-checks source safety.
 */
export async function failJobsForUnsafeSource(
  client: PoolClient,
  input: UnsafeSourceJobSettlement,
): Promise<void> {
  const settledAt = input.settledAt ?? new Date().toISOString();
  const values = [
    input.projectId,
    input.sourceVersionId,
    input.errorCode.slice(0, 128),
    settledAt,
  ];
  await client.query(
    `UPDATE processing_jobs
     SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
         error_code = $3, updated_at = $4
     WHERE project_id = $1 AND source_version_id = $2
       AND status IN ('queued', 'processing', 'verifying')`,
    values,
  );
  await client.query(
    `UPDATE export_jobs
     SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
         error_code = $3, updated_at = $4
     WHERE project_id = $1 AND source_version_id = $2
       AND status IN ('queued', 'generating', 'verifying')`,
    values,
  );
  await client.query(
    `UPDATE projects AS project
     SET active_job_type = NULL, active_job_id = NULL, updated_at = $3
     WHERE project.id = $1
       AND (
         (project.active_job_type = 'processing' AND EXISTS (
           SELECT 1 FROM processing_jobs AS job
           WHERE job.id = project.active_job_id
             AND job.source_version_id = $2 AND job.status = 'failed'
         ))
         OR (project.active_job_type = 'export' AND EXISTS (
           SELECT 1 FROM export_jobs AS job
           WHERE job.id = project.active_job_id
             AND job.source_version_id = $2 AND job.status = 'failed'
         ))
       )`,
    [input.projectId, input.sourceVersionId, settledAt],
  );
}
