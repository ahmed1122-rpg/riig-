import type { ExportJob, ProcessingJob } from "@motionprep/contracts";
import type { Pool } from "pg";

export async function releaseProcessingJobForShutdown(
  pool: Pool,
  job: ProcessingJob,
  workerId: string,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE processing_jobs
     SET status = 'queued',
         progress = 0,
         attempt = GREATEST(0, attempt - 1),
         next_attempt_at = now(),
         lease_owner = NULL,
         lease_expires_at = NULL,
         error_code = 'WORKER_SHUTDOWN_REQUEUE',
         updated_at = now()
     WHERE id = $1
       AND lease_owner = $2
       AND status IN ('processing', 'verifying')`,
    [job.id, workerId],
  );
  return result.rowCount === 1;
}

export async function releaseExportJobForShutdown(
  pool: Pool,
  job: ExportJob,
  workerId: string,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE export_jobs
     SET status = 'queued',
         progress = 0,
         attempt = GREATEST(0, attempt - 1),
         next_attempt_at = now(),
         lease_owner = NULL,
         lease_expires_at = NULL,
         error_code = 'WORKER_SHUTDOWN_REQUEUE',
         updated_at = now()
     WHERE id = $1
       AND lease_owner = $2
       AND status IN ('generating', 'verifying')`,
    [job.id, workerId],
  );
  return result.rowCount === 1;
}
