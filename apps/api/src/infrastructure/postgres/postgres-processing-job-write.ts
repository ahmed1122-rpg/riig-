import type { ProcessingJob } from "@motionprep/contracts";
import type { Pool, PoolClient } from "pg";

const processingInsert = `INSERT INTO processing_jobs (
  id, project_id, source_version_id, project_kind, options, status,
  progress, attempt, max_attempts, next_attempt_at, lease_owner,
  lease_expires_at, error_code, correlation_id, trace_parent,
  trace_state, created_at, updated_at
) VALUES (
  $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13,
  $14, $15, $16, $17, $18
)`;

export async function upsertProcessingJob(
  database: Pool | PoolClient,
  job: ProcessingJob,
): Promise<void> {
  await database.query(
    `${processingInsert}
     ON CONFLICT (id) DO UPDATE SET
       options = EXCLUDED.options,
       status = EXCLUDED.status,
       progress = EXCLUDED.progress,
       attempt = EXCLUDED.attempt,
       max_attempts = EXCLUDED.max_attempts,
       next_attempt_at = EXCLUDED.next_attempt_at,
       lease_owner = EXCLUDED.lease_owner,
       lease_expires_at = EXCLUDED.lease_expires_at,
       error_code = EXCLUDED.error_code,
       correlation_id = COALESCE(EXCLUDED.correlation_id, processing_jobs.correlation_id),
       trace_parent = COALESCE(EXCLUDED.trace_parent, processing_jobs.trace_parent),
       trace_state = COALESCE(EXCLUDED.trace_state, processing_jobs.trace_state),
       updated_at = EXCLUDED.updated_at`,
    processingJobParameters(job),
  );
}

export async function insertProcessingJob(
  client: PoolClient,
  job: ProcessingJob,
): Promise<boolean> {
  const result = await client.query(
    `${processingInsert} ON CONFLICT (id) DO NOTHING`,
    processingJobParameters(job),
  );
  return result.rowCount === 1;
}

function processingJobParameters(job: ProcessingJob): unknown[] {
  return [
    job.id,
    job.projectId,
    job.sourceVersionId,
    job.projectKind,
    JSON.stringify(job.options),
    job.status,
    job.progress,
    job.attempt,
    job.maxAttempts,
    job.nextAttemptAt,
    job.leaseOwner,
    job.leaseExpiresAt,
    job.errorCode,
    job.correlationId ?? null,
    job.traceContext?.traceparent ?? null,
    job.traceContext?.tracestate ?? null,
    job.createdAt,
    job.updatedAt,
  ];
}
