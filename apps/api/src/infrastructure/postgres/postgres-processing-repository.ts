import type { ProcessingJob } from "@motionprep/contracts";
import type { Pool } from "pg";
import type {
  ProcessingJobRepository,
  ProcessingStatusSummary,
} from "../../processing/processing-repository.js";
import {
  boundedJobListLimit,
  type JobListCursor,
} from "../../jobs/job-list-cursor.js";
import {
  mapProcessingRow,
  type ProcessingRow,
} from "./processing-row.js";
import {
  insertProcessingJob,
  upsertProcessingJob,
} from "./postgres-processing-job-write.js";
import { availableProjectWorkFenceSql } from "./postgres-project-work-fence.js";

export class PostgresProcessingJobRepository
  implements ProcessingJobRepository
{
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<ProcessingJob | null> {
    const result = await this.pool.query<ProcessingRow>(
      `${processingSelect} WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapProcessingRow(result.rows[0]) : null;
  }

  async list(limit: number): Promise<ProcessingJob[]> {
    const result = await this.pool.query<ProcessingRow>(
      `${processingSelect} ORDER BY created_at DESC LIMIT $1`,
      [boundedJobListLimit(limit)],
    );
    return result.rows.map(mapProcessingRow);
  }

  async listByProjectIds(
    projectIds: string[],
    limit: number,
    cursor?: JobListCursor,
  ): Promise<ProcessingJob[]> {
    if (projectIds.length === 0) return [];
    const cursorClause = cursor
      ? "AND (updated_at < $3 OR (updated_at = $3 AND ('processing:' || id::text) < $4))"
      : "";
    const parameters = cursor
      ? [projectIds, boundedJobListLimit(limit), cursor.updatedAt, cursor.id]
      : [projectIds, boundedJobListLimit(limit)];
    const result = await this.pool.query<ProcessingRow>(
      `${processingSelect}
       WHERE project_id = ANY($1::uuid[])
       ${cursorClause}
       ORDER BY updated_at DESC, id DESC
       LIMIT $2`,
      parameters,
    );
    return result.rows.map(mapProcessingRow);
  }

  async summarizeStatuses(): Promise<ProcessingStatusSummary> {
    const result = await this.pool.query<{
      total: string | number;
      active: string | number;
      failed: string | number;
    }>(`SELECT
          count(*) AS total,
          count(*) FILTER (
            WHERE status IN ('queued', 'processing', 'verifying')
          ) AS active,
          count(*) FILTER (WHERE status = 'failed') AS failed
        FROM processing_jobs`);
    const row = result.rows[0];
    return {
      total: Number(row?.total ?? 0),
      active: Number(row?.active ?? 0),
      failed: Number(row?.failed ?? 0),
    };
  }

  async findBySource(
    projectId: string,
    sourceVersionId: string,
  ): Promise<ProcessingJob | null> {
    const result = await this.pool.query<ProcessingRow>(
      `${processingSelect}
       WHERE project_id = $1 AND source_version_id = $2
         AND status IN ('queued', 'processing', 'verifying')
       ORDER BY created_at DESC
       LIMIT 1`,
      [projectId, sourceVersionId],
    );
    return result.rows[0] ? mapProcessingRow(result.rows[0]) : null;
  }

  async enqueue(
    job: ProcessingJob,
    _activateProject?: () => Promise<boolean>,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const activated = await client.query(
        `UPDATE projects AS project
         SET status = 'processing',
             current_review_approval_id = NULL,
             active_job_type = 'processing',
             active_job_id = $3,
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
             FROM users AS owner
             WHERE owner.id = project.owner_user_id
               AND owner.deletion_requested_at IS NULL
               AND owner.deleted_at IS NULL
           )`,
        [job.projectId, job.sourceVersionId, job.id],
      );
      if (activated.rowCount !== 1) {
        await client.query("ROLLBACK");
        return false;
      }
      const inserted = await insertProcessingJob(client, job);
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

  async save(job: ProcessingJob): Promise<void> {
    await upsertProcessingJob(this.pool, job);
  }

  async retryFailed(
    id: string,
    retriedAt: string,
    _activateProject?: (job: ProcessingJob) => Promise<boolean>,
  ): Promise<ProcessingJob | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<ProcessingRow>(
        `UPDATE processing_jobs AS job
       SET status = 'queued',
           progress = 0,
           attempt = 0,
           next_attempt_at = $2,
           lease_owner = NULL,
           lease_expires_at = NULL,
           error_code = NULL,
           updated_at = $2
       WHERE job.id = $1
         AND job.status = 'failed'
         AND EXISTS (
           SELECT 1
           FROM upload_sessions AS upload
           WHERE upload.project_id = job.project_id
             AND upload.source_version_id = job.source_version_id
             AND upload.status = 'ready'
         )
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
       RETURNING
         id, project_id, source_version_id, project_kind, options, status,
         progress, attempt, max_attempts, next_attempt_at, lease_owner,
         lease_expires_at, error_code, correlation_id, trace_parent,
         trace_state, created_at, updated_at`,
        [id, retriedAt],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      const activated = await client.query(
        `UPDATE projects
         SET status = 'queued',
             current_review_approval_id = NULL,
             active_job_type = 'processing',
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
           )`,
        [row.project_id, row.source_version_id, row.id, retriedAt],
      );
      if (activated.rowCount !== 1) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query("COMMIT");
      return mapProcessingRow(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

const processingSelect = `
  SELECT
    id, project_id, source_version_id, project_kind, options, status, progress,
    attempt, max_attempts, next_attempt_at, lease_owner, lease_expires_at,
    error_code, correlation_id, trace_parent, trace_state, created_at, updated_at
  FROM processing_jobs
`;
