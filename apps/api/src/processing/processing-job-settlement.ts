import type { ProcessingJob } from "@motionprep/contracts";
import type { Pool } from "pg";
import { updateProjectStatusForJob } from "../projects/project-job-status.js";
import { getProcessingRetryPolicy } from "./processing-worker-policy.js";

export async function retryOrFailProcessingJob(
  pool: Pool,
  job: ProcessingJob,
  workerId: string,
  errorCode: string,
): Promise<"queued" | "failed" | "lease_lost"> {
  const policy = getProcessingRetryPolicy(job.attempt, job.maxAttempts);
  const retry =
    policy.retry &&
    ![
      "DOCUMENT_REVISION_CONFLICT",
      "INVALID_DOCUMENT_OPERATION",
      "INVALID_PROCESSING_OPTIONS",
    ].includes(errorCode);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ status: "queued" | "failed" }>(
      `UPDATE processing_jobs
       SET status = CASE WHEN $5 THEN 'queued' ELSE 'failed' END,
           progress = CASE WHEN $5 THEN 0 ELSE progress END,
           next_attempt_at = CASE
             WHEN $5 THEN now() + ($4 * interval '1 millisecond')
             ELSE next_attempt_at END,
           lease_owner = NULL,
           lease_expires_at = NULL,
           error_code = $3,
           updated_at = now()
       WHERE id = $1
         AND lease_owner = $2
         AND status IN ('processing', 'verifying')
       RETURNING status`,
      [job.id, workerId, errorCode, policy.delayMilliseconds, retry],
    );
    const status = result.rows[0]?.status;
    if (!status) {
      await client.query("ROLLBACK");
      return "lease_lost";
    }
    if (status === "failed") {
      const settled = await updateProjectStatusForJob(client, {
        projectId: job.projectId,
        sourceVersionId: job.sourceVersionId,
        jobType: "processing",
        jobId: job.id,
        status: job.options.pdfRegionOcr ? "needs_review" : "failed",
        finished: true,
      });
      if (!settled) {
        await client.query("ROLLBACK");
        return "lease_lost";
      }
    }
    await client.query("COMMIT");
    return status;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
