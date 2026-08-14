import type { ExportJob } from "@motionprep/contracts";
import type { Pool } from "pg";
import type {
  ExportRepository,
  ExportStatusSummary,
} from "../../exports/export-repository.js";
import type { JobListCursor } from "../../jobs/job-list-cursor.js";
import { updateProjectStatusForJob } from "../../projects/project-job-status.js";
import {
  insertExportJob,
  upsertExportJob,
} from "./postgres-export-job-write.js";
import { updateExportClaim } from "./postgres-export-claim-update.js";
import { mapExportRow as mapExport, type ExportRow } from "./postgres-export-row.js";
import { availableProjectWorkFenceSql } from "./postgres-project-work-fence.js";

export class PostgresExportRepository implements ExportRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<ExportJob | null> {
    const result = await this.pool.query<ExportRow>(
      `${exportSelect} WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapExport(result.rows[0]) : null;
  }

  async list(limit: number): Promise<ExportJob[]> {
    const result = await this.pool.query<ExportRow>(
      `${exportSelect} ORDER BY created_at DESC LIMIT $1`,
      [boundedListLimit(limit)],
    );
    return result.rows.map(mapExport);
  }

  async listByProjectIds(
    projectIds: string[],
    limit: number,
    cursor?: JobListCursor,
  ): Promise<ExportJob[]> {
    if (projectIds.length === 0) return [];
    const cursorClause = cursor
      ? "AND (updated_at < $3 OR (updated_at = $3 AND ('export:' || id::text) < $4))"
      : "";
    const parameters = cursor
      ? [projectIds, boundedListLimit(limit), cursor.updatedAt, cursor.id]
      : [projectIds, boundedListLimit(limit)];
    const result = await this.pool.query<ExportRow>(
      `${exportSelect}
       WHERE project_id = ANY($1::uuid[])
       ${cursorClause}
       ORDER BY updated_at DESC, id DESC
       LIMIT $2`,
      parameters,
    );
    return result.rows.map(mapExport);
  }

  async summarizeStatuses(): Promise<ExportStatusSummary> {
    const result = await this.pool.query<{
      total: string | number;
      queued: string | number;
      failed: string | number;
    }>(`SELECT
          count(*) AS total,
          count(*) FILTER (WHERE status = 'queued') AS queued,
          count(*) FILTER (WHERE status = 'failed') AS failed
        FROM export_jobs`);
    const row = result.rows[0];
    return {
      total: Number(row?.total ?? 0),
      queued: Number(row?.queued ?? 0),
      failed: Number(row?.failed ?? 0),
    };
  }

  async enqueue(
    job: ExportJob,
    _activateProject?: () => Promise<boolean>,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const activated = await client.query(
        `UPDATE projects AS project
         SET status = 'exporting',
             active_job_type = 'export',
             active_job_id = $4,
             updated_at = now()
         WHERE project.id = $1
            AND project.current_source_version_id = $2
            ${availableProjectWorkFenceSql("project", "now()")}
           AND EXISTS (
             SELECT 1
             FROM upload_sessions AS upload
             WHERE upload.project_id = project.id
               AND upload.source_version_id = $2
               AND upload.status = 'ready'
           )
           AND EXISTS (
             SELECT 1
             FROM layer_document_revisions AS revision
             WHERE revision.project_id = project.id
               AND revision.source_version_id = $2
               AND revision.revision = $3
           )
           AND EXISTS (
             SELECT 1
             FROM project_review_approvals AS approval
             WHERE approval.id = project.current_review_approval_id
               AND approval.source_version_id = $2
               AND approval.document_revision = $3
           )
           AND EXISTS (
             SELECT 1
             FROM users AS owner
             WHERE owner.id = project.owner_user_id
               AND owner.deletion_requested_at IS NULL
               AND owner.deleted_at IS NULL
           )`,
        [job.projectId, job.sourceVersionId, job.documentRevision ?? 1, job.id],
      );
      if (activated.rowCount !== 1) {
        await client.query("ROLLBACK");
        return false;
      }
      const inserted = await insertExportJob(client, job);
      if (!inserted) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async save(job: ExportJob): Promise<void> {
    await upsertExportJob(this.pool, job);
  }

  async claimNext(
    workerId: string,
    claimedAt: string,
    leaseExpiresAt: string,
  ): Promise<ExportJob | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<ExportRow>(
        `
        WITH candidate AS (
          SELECT queued_job.id
          FROM export_jobs AS queued_job
          WHERE queued_job.attempt < queued_job.max_attempts
            AND (
              (
                queued_job.status = 'queued'
                AND queued_job.next_attempt_at <= $2
              ) OR
              (
                queued_job.status IN ('generating', 'verifying') AND
                queued_job.lease_expires_at IS NOT NULL AND
                queued_job.lease_expires_at <= $2
              )
            )
            AND EXISTS (
              SELECT 1
              FROM projects AS project
              JOIN users AS owner ON owner.id = project.owner_user_id
              WHERE project.id = queued_job.project_id
                AND project.current_source_version_id = queued_job.source_version_id
                AND project.active_job_type = 'export'
                AND project.active_job_id = queued_job.id
                AND owner.deletion_requested_at IS NULL
                AND owner.deleted_at IS NULL
            )
          ORDER BY queued_job.created_at
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
      const row = result.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return null;
      }
      const fenced = await updateProjectStatusForJob(client, {
        projectId: row.project_id,
        sourceVersionId: row.source_version_id,
        jobType: "export",
        jobId: row.id,
        status: "exporting",
        finished: false,
        documentRevision: row.document_revision,
        requireActiveOwner: true,
      });
      if (!fenced) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query("COMMIT");
      return mapExport(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateClaim(
    id: string,
    workerId: string,
    changes: Partial<ExportJob>,
    updatedAt: string,
  ): Promise<ExportJob | null> {
    const result = await updateExportClaim(
      this.pool,
      exportReturningColumns,
      id,
      workerId,
      changes,
      updatedAt,
    );
    return result.rows[0] ? mapExport(result.rows[0]) : null;
  }

  async settleClaim(
    id: string,
    workerId: string,
    changes: Partial<ExportJob>,
    updatedAt: string,
  ): Promise<ExportJob | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await updateExportClaim(
        client,
        exportReturningColumns,
        id,
        workerId,
        changes,
        updatedAt,
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      if (["ready", "failed", "cancelled"].includes(row.status)) {
        const settled = await updateProjectStatusForJob(client, {
          projectId: row.project_id,
          sourceVersionId: row.source_version_id,
          jobType: "export",
          jobId: row.id,
          status:
            row.status === "ready"
              ? "completed"
              : row.status === "cancelled"
                ? "cancelled"
                : "failed",
          finished: true,
          documentRevision: row.document_revision,
        });
        if (!settled) {
          await client.query("ROLLBACK");
          return null;
        }
      }
      await client.query("COMMIT");
      return mapExport(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async retryOrFailClaim(
    id: string,
    workerId: string,
    errorCode: string,
    nextAttemptAt: string,
    updatedAt: string,
  ): Promise<ExportJob | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<ExportRow>(
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
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      if (row.status === "failed") {
        const settled = await updateProjectStatusForJob(client, {
          projectId: row.project_id,
          sourceVersionId: row.source_version_id,
          jobType: "export",
          jobId: row.id,
          status: "failed",
          finished: true,
          documentRevision: row.document_revision,
        });
        if (!settled) {
          await client.query("ROLLBACK");
          return null;
        }
      }
      const mapped = mapExport(row);
      await client.query("COMMIT");
      return mapped;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the authoritative job-settlement error.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async retryFailed(
    id: string,
    retriedAt: string,
    _activateProject?: (job: ExportJob) => Promise<boolean>,
  ): Promise<ExportJob | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<ExportRow>(
        `UPDATE export_jobs AS job
       SET status = 'queued',
           progress = 0,
           attempt = 0,
           next_attempt_at = $2,
           lease_owner = NULL,
           lease_expires_at = NULL,
           error_code = NULL,
           artifact = NULL,
           updated_at = $2
       WHERE job.id = $1
         AND job.status = 'failed'
         AND EXISTS (
           SELECT 1
           FROM projects AS project
           JOIN users AS owner ON owner.id = project.owner_user_id
           WHERE project.id = job.project_id
             AND project.current_source_version_id = job.source_version_id
             ${availableProjectWorkFenceSql("project", "$2")}
             AND owner.deletion_requested_at IS NULL
             AND owner.deleted_at IS NULL
         )
         AND EXISTS (
           SELECT 1
           FROM upload_sessions AS upload
           WHERE upload.project_id = job.project_id
             AND upload.source_version_id = job.source_version_id
             AND upload.status = 'ready'
         )
         AND EXISTS (
           SELECT 1
           FROM layer_document_revisions AS revision
           WHERE revision.project_id = job.project_id
             AND revision.source_version_id = job.source_version_id
             AND revision.revision = job.document_revision
         )
         AND EXISTS (
           SELECT 1
           FROM projects AS approved_project
           JOIN project_review_approvals AS approval
             ON approval.id = approved_project.current_review_approval_id
           WHERE approved_project.id = job.project_id
             AND approval.source_version_id = job.source_version_id
             AND approval.document_revision = job.document_revision
         )
       RETURNING ${exportReturningColumns}`,
        [id, retriedAt],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      const activated = await client.query(
        `UPDATE projects
         SET status = 'exporting',
             active_job_type = 'export',
             active_job_id = $3,
             updated_at = $4
         WHERE id = $1
           AND current_source_version_id = $2
           ${availableProjectWorkFenceSql("projects", "$4")}
           AND EXISTS (
             SELECT 1 FROM users AS owner
             WHERE owner.id = projects.owner_user_id
               AND owner.deletion_requested_at IS NULL
               AND owner.deleted_at IS NULL
           )
           AND EXISTS (
             SELECT 1 FROM project_review_approvals AS approval
             WHERE approval.id = projects.current_review_approval_id
               AND approval.source_version_id = $2
               AND approval.document_revision = $5
           )`,
        [
          row.project_id,
          row.source_version_id,
          row.id,
          retriedAt,
          row.document_revision,
        ],
      );
      if (activated.rowCount !== 1) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query("COMMIT");
      return mapExport(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async requestCancel(
    id: string,
    updatedAt: string,
  ): Promise<ExportJob | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<ExportRow>(
        `
        UPDATE export_jobs AS job
        SET
          status = 'cancelled',
          lease_owner = NULL,
          lease_expires_at = NULL,
          updated_at = $2
        WHERE job.id = $1
          AND job.status IN ('queued', 'generating')
        RETURNING ${exportReturningColumns}
        `,
        [id, updatedAt],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return this.findById(id);
      }
      const settled = await updateProjectStatusForJob(client, {
        projectId: row.project_id,
        sourceVersionId: row.source_version_id,
        jobType: "export",
        jobId: row.id,
        status: "cancelled",
        finished: true,
        documentRevision: row.document_revision,
      });
      if (!settled) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query("COMMIT");
      return mapExport(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function boundedListLimit(limit: number): number {
  return Math.max(1, Math.min(Math.trunc(limit), 200));
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
