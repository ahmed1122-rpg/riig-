import type { ProcessingJob, ProjectKind } from "@motionprep/contracts";
import type { Pool } from "pg";
import {
  mapProcessingRow,
  type ProcessingRow,
} from "../infrastructure/postgres/processing-row.js";
import { updateProjectStatusForJob } from "../projects/project-job-status.js";

export async function claimNextProcessingJob(
  pool: Pool,
  projectKind: ProjectKind,
  workerId: string,
  leaseMilliseconds: number,
): Promise<ProcessingJob | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const exhausted = await client.query<{
      id: string;
      project_id: string;
      source_version_id: string;
      options: ProcessingJob["options"];
    }>(
      `UPDATE processing_jobs
       SET status = 'failed',
           error_code = 'WORKER_LEASE_EXHAUSTED',
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = now()
       WHERE project_kind = $1
         AND status IN ('processing', 'verifying')
         AND lease_expires_at <= now()
         AND attempt >= max_attempts
       RETURNING id, project_id, source_version_id, options`,
      [projectKind],
    );
    for (const row of exhausted.rows) {
      await updateProjectStatusForJob(client, {
        projectId: row.project_id,
        sourceVersionId: row.source_version_id,
        jobType: "processing",
        jobId: row.id,
        status: row.options.pdfRegionOcr ? "needs_review" : "failed",
        finished: true,
      });
    }

    const result = await client.query<ProcessingRow>(
      `WITH candidate AS (
         SELECT id
         FROM processing_jobs
         WHERE project_kind = $1
           AND attempt < max_attempts
           AND (
             (status = 'queued' AND next_attempt_at <= now())
             OR (
               status IN ('processing', 'verifying')
               AND lease_expires_at <= now()
             )
           )
         ORDER BY next_attempt_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE processing_jobs AS job
       SET status = 'processing',
           progress = 25,
           attempt = job.attempt + 1,
           lease_owner = $2,
           lease_expires_at = now() + ($3 * interval '1 millisecond'),
           error_code = NULL,
           updated_at = now()
       FROM candidate
       WHERE job.id = candidate.id
       RETURNING
         job.id, job.project_id, job.source_version_id, job.project_kind,
         job.options, job.status, job.progress, job.attempt, job.max_attempts,
         job.next_attempt_at, job.lease_owner, job.lease_expires_at,
         job.error_code, job.correlation_id, job.trace_parent, job.trace_state,
         job.created_at, job.updated_at`,
      [projectKind, workerId, leaseMilliseconds],
    );
    if (result.rows[0]) {
      await updateProjectStatusForJob(client, {
        projectId: result.rows[0].project_id,
        sourceVersionId: result.rows[0].source_version_id,
        jobType: "processing",
        jobId: result.rows[0].id,
        status: "processing",
        finished: false,
      });
    }
    await client.query("COMMIT");
    return result.rows[0] ? mapProcessingRow(result.rows[0]) : null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
