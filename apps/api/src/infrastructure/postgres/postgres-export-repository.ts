import type {
  ExportFormat,
  ExportJob,
  ExportJobStatus,
  ExportScope,
  ProjectKind,
} from "@motionprep/contracts";
import type { Pool } from "pg";
import type { ExportRepository } from "../../exports/export-repository.js";
import {
  mapQueuedJobRow,
  type QueuedJobRow,
} from "./queued-job-row.js";

interface ExportRow extends QueuedJobRow<ExportJobStatus> {
  id: string;
  correlation_id: string | null;
  trace_parent: string | null;
  trace_state: string | null;
  project_id: string;
  source_version_id: string;
  document_revision: number;
  project_kind: ProjectKind;
  format: ExportFormat;
  scope: ExportScope;
  selected_page: number | null;
  scale: 1 | 2;
  color_profile: "sRGB" | "display-p3";
  naming_preset_id: string;
  artifact: ExportJob["artifact"] | null;
}

export class PostgresExportRepository implements ExportRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<ExportJob | null> {
    const result = await this.pool.query<ExportRow>(
      `${exportSelect} WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapExport(result.rows[0]) : null;
  }

  async list(): Promise<ExportJob[]> {
    const result = await this.pool.query<ExportRow>(
      `${exportSelect} ORDER BY created_at DESC`,
    );
    return result.rows.map(mapExport);
  }

  async listByProjectIds(projectIds: string[]): Promise<ExportJob[]> {
    if (projectIds.length === 0) return [];
    const result = await this.pool.query<ExportRow>(
      `${exportSelect}
       WHERE project_id = ANY($1::uuid[])
       ORDER BY created_at DESC`,
      [projectIds],
    );
    return result.rows.map(mapExport);
  }

  async save(job: ExportJob): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO export_jobs (
          id, project_id, source_version_id, project_kind, format, scope,
          document_revision, selected_page, scale, color_profile,
          naming_preset_id, status,
          progress, attempt, max_attempts, next_attempt_at, lease_owner,
          lease_expires_at, error_code, artifact, correlation_id, trace_parent,
          trace_state, created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
        )
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
          updated_at = EXCLUDED.updated_at
      `,
      [
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
      ],
    );
  }

  async claimNext(
    workerId: string,
    claimedAt: string,
    leaseExpiresAt: string,
  ): Promise<ExportJob | null> {
    const result = await this.pool.query<ExportRow>(
      `
        WITH candidate AS (
          SELECT id
          FROM export_jobs
          WHERE attempt < max_attempts
            AND (
              (status = 'queued' AND next_attempt_at <= $2) OR
              (
                status IN ('generating', 'verifying') AND
                lease_expires_at IS NOT NULL AND
                lease_expires_at <= $2
              )
            )
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE export_jobs AS job
        SET
          status = 'generating',
          progress = GREATEST(job.progress, 10),
          attempt = job.attempt + 1,
          lease_owner = $1,
          lease_expires_at = $3,
          error_code = NULL,
          updated_at = $2
        FROM candidate
        WHERE job.id = candidate.id
        RETURNING ${exportReturningColumns}
      `,
      [workerId, claimedAt, leaseExpiresAt],
    );
    return result.rows[0] ? mapExport(result.rows[0]) : null;
  }

  async updateClaim(
    id: string,
    workerId: string,
    changes: Partial<ExportJob>,
    updatedAt: string,
  ): Promise<ExportJob | null> {
    const hasArtifact = Object.prototype.hasOwnProperty.call(
      changes,
      "artifact",
    );
    const hasLeaseOwner = Object.prototype.hasOwnProperty.call(
      changes,
      "leaseOwner",
    );
    const hasLeaseExpiry = Object.prototype.hasOwnProperty.call(
      changes,
      "leaseExpiresAt",
    );
    const hasErrorCode = Object.prototype.hasOwnProperty.call(
      changes,
      "errorCode",
    );
    const result = await this.pool.query<ExportRow>(
      `
        UPDATE export_jobs AS job
        SET
          status = COALESCE($3, status),
          progress = COALESCE($4, progress),
          artifact = CASE WHEN $5 THEN $6::jsonb ELSE artifact END,
          lease_owner = CASE WHEN $7 THEN $8 ELSE lease_owner END,
          lease_expires_at = CASE
            WHEN $9 THEN $10::timestamptz
            ELSE lease_expires_at
          END,
          error_code = CASE WHEN $11 THEN $12 ELSE error_code END,
          updated_at = $13
        WHERE job.id = $1
          AND job.lease_owner = $2
          AND job.status <> 'cancelled'
          AND job.lease_expires_at > $13
        RETURNING ${exportReturningColumns}
      `,
      [
        id,
        workerId,
        changes.status ?? null,
        changes.progress ?? null,
        hasArtifact,
        changes.artifact ? JSON.stringify(changes.artifact) : null,
        hasLeaseOwner,
        changes.leaseOwner ?? null,
        hasLeaseExpiry,
        changes.leaseExpiresAt ?? null,
        hasErrorCode,
        changes.errorCode ?? null,
        updatedAt,
      ],
    );
    return result.rows[0] ? mapExport(result.rows[0]) : null;
  }

  async retryOrFailClaim(
    id: string,
    workerId: string,
    errorCode: string,
    nextAttemptAt: string,
    updatedAt: string,
  ): Promise<ExportJob | null> {
    const result = await this.pool.query<ExportRow>(
      `
        UPDATE export_jobs AS job
        SET
          status = CASE
            WHEN attempt >= max_attempts THEN 'failed'
            ELSE 'queued'
          END,
          progress = CASE
            WHEN attempt >= max_attempts THEN progress
            ELSE 0
          END,
          next_attempt_at = $4,
          lease_owner = NULL,
          lease_expires_at = NULL,
          error_code = $3,
          updated_at = $5
        WHERE job.id = $1
          AND job.lease_owner = $2
          AND job.status <> 'cancelled'
        RETURNING ${exportReturningColumns}
      `,
      [id, workerId, errorCode, nextAttemptAt, updatedAt],
    );
    return result.rows[0] ? mapExport(result.rows[0]) : null;
  }

  async requestCancel(
    id: string,
    updatedAt: string,
  ): Promise<ExportJob | null> {
    const result = await this.pool.query<ExportRow>(
      `
        UPDATE export_jobs AS job
        SET
          status = 'cancelled',
          lease_owner = NULL,
          lease_expires_at = NULL,
          updated_at = $2
        WHERE job.id = $1
          AND job.status IN ('preflight', 'queued', 'generating')
        RETURNING ${exportReturningColumns}
      `,
      [id, updatedAt],
    );
    if (result.rows[0]) return mapExport(result.rows[0]);
    return this.findById(id);
  }
}

const exportColumns = `
  id, project_id, source_version_id, project_kind, format, scope,
  document_revision,
  selected_page, scale, color_profile, naming_preset_id, status, progress,
  attempt, max_attempts, next_attempt_at, lease_owner, lease_expires_at,
  error_code, artifact, correlation_id, trace_parent, trace_state, created_at, updated_at
`;

const exportReturningColumns = `
  job.id, job.project_id, job.source_version_id, job.project_kind, job.format,
  job.scope, job.document_revision, job.selected_page, job.scale, job.color_profile,
  job.naming_preset_id, job.status, job.progress, job.attempt,
  job.max_attempts, job.next_attempt_at, job.lease_owner,
  job.lease_expires_at, job.error_code, job.artifact, job.correlation_id,
  job.trace_parent, job.trace_state, job.created_at, job.updated_at
`;

const exportSelect = `SELECT ${exportColumns} FROM export_jobs`;

function mapExport(row: ExportRow): ExportJob {
  return {
    id: row.id,
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
    ...(row.trace_parent
      ? {
          traceContext: {
            traceparent: row.trace_parent,
            ...(row.trace_state ? { tracestate: row.trace_state } : {}),
          },
        }
      : {}),
    projectId: row.project_id,
    sourceVersionId: row.source_version_id,
    documentRevision: row.document_revision,
    projectKind: row.project_kind,
    format: row.format,
    scope: row.scope,
    ...(row.selected_page === null
      ? {}
      : { selectedPage: row.selected_page }),
    scale: row.scale,
    colorProfile: row.color_profile,
    namingPresetId: row.naming_preset_id,
    ...mapQueuedJobRow(row),
    ...(row.artifact ? { artifact: row.artifact } : {}),
  };
}
