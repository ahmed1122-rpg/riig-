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
}

export async function updateProjectStatusForJob(
  database: Pool | PoolClient,
  input: ProjectJobStatusInput,
): Promise<boolean> {
  const result = await database.query(
    `UPDATE projects
     SET status = $5,
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
    ],
  );
  return result.rowCount === 1;
}
