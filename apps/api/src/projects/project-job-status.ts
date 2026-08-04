import type { Pool, PoolClient } from "pg";
import type { ProjectStatus } from "@motionprep/contracts";
import type { ProjectJobType } from "./project-repository.js";

interface ProjectJobStatusInput {
  projectId: string;
  sourceVersionId: string;
  jobType: ProjectJobType;
  jobId: string;
  status: ProjectStatus;
  finished: boolean;
  documentRevision?: number;
}

export async function updateProjectStatusForJob(
  database: Pool | PoolClient,
  input: ProjectJobStatusInput,
): Promise<boolean> {
  const result = await database.query(
    `UPDATE projects
     SET status = CASE
           WHEN $3 <> 'export' OR NOT $6 THEN $5
           WHEN EXISTS (
             SELECT 1
             FROM project_review_approvals AS approval
             WHERE approval.id = projects.current_review_approval_id
               AND approval.source_version_id = $2
               AND approval.document_revision = $7
           ) THEN CASE
             WHEN $5 = 'completed' THEN 'completed'
             ELSE 'approved'
           END
           ELSE 'needs_review'
         END,
         active_job_type = CASE WHEN $6 THEN NULL ELSE active_job_type END,
         active_job_id = CASE WHEN $6 THEN NULL ELSE active_job_id END,
         updated_at = now()
     WHERE id = $1
       AND current_source_version_id = $2
       AND active_job_type = $3
       AND active_job_id = $4`,
    [
      input.projectId,
      input.sourceVersionId,
      input.jobType,
      input.jobId,
      input.status,
      input.finished,
      input.documentRevision ?? null,
    ],
  );
  return result.rowCount === 1;
}
