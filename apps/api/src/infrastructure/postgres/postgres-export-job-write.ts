import type { ExportJob } from "@motionprep/contracts";
import type { Pool, PoolClient } from "pg";

const exportInsert = `INSERT INTO export_jobs (
  id, project_id, source_version_id, project_kind, format, scope,
  document_revision, selected_page, scale, color_profile, naming_preset_id,
  status, progress, attempt, max_attempts, next_attempt_at, lease_owner,
  lease_expires_at, error_code, artifact, correlation_id, trace_parent,
  trace_state, created_at, updated_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
  $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
)`;

export async function upsertExportJob(
  database: Pool | PoolClient,
  job: ExportJob,
): Promise<void> {
  await database.query(
    `${exportInsert}
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       progress = EXCLUDED.progress,
       attempt = EXCLUDED.attempt,
       max_attempts = EXCLUDED.max_attempts,
       next_attempt_at = EXCLUDED.next_attempt_at,
       lease_owner = EXCLUDED.lease_owner,
       lease_expires_at = EXCLUDED.lease_expires_at,
       error_code = EXCLUDED.error_code,
       artifact = EXCLUDED.artifact,
       correlation_id = COALESCE(EXCLUDED.correlation_id, export_jobs.correlation_id),
       trace_parent = COALESCE(EXCLUDED.trace_parent, export_jobs.trace_parent),
       trace_state = COALESCE(EXCLUDED.trace_state, export_jobs.trace_state),
       updated_at = EXCLUDED.updated_at`,
    exportJobParameters(job),
  );
}

export async function insertExportJob(
  client: PoolClient,
  job: ExportJob,
): Promise<boolean> {
  const result = await client.query(
    `${exportInsert} ON CONFLICT (id) DO NOTHING`,
    exportJobParameters(job),
  );
  return result.rowCount === 1;
}

function exportJobParameters(job: ExportJob): unknown[] {
  return [
    job.id,
    job.projectId,
    job.sourceVersionId,
    job.projectKind,
    job.format,
    job.scope,
    job.documentRevision ?? 1,
    job.selectedPage ?? null,
    job.scale,
    job.colorProfile,
    job.namingPresetId,
    job.status,
    job.progress,
    job.attempt,
    job.maxAttempts,
    job.nextAttemptAt,
    job.leaseOwner,
    job.leaseExpiresAt,
    job.errorCode,
    job.artifact ? JSON.stringify(job.artifact) : null,
    job.correlationId ?? null,
    job.traceContext?.traceparent ?? null,
    job.traceContext?.tracestate ?? null,
    job.createdAt,
    job.updatedAt,
  ];
}
