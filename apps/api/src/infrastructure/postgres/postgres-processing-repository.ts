import type {
  LayerDocument,
  ProcessingJob,
} from "@motionprep/contracts";
import type { Pool, PoolClient } from "pg";
import type {
  LayerDocumentRepository,
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

interface DocumentRow {
  document: LayerDocument;
}

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

  async save(job: ProcessingJob): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO processing_jobs (
          id, project_id, source_version_id, project_kind, options, status,
          progress, attempt, max_attempts, next_attempt_at, lease_owner,
          lease_expires_at, error_code, correlation_id, trace_parent,
          trace_state, created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18
        )
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
          updated_at = EXCLUDED.updated_at
      `,
      [
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
      ],
    );
  }

  async retryFailed(
    id: string,
    retriedAt: string,
  ): Promise<ProcessingJob | null> {
    const result = await this.pool.query<ProcessingRow>(
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
           FROM projects AS project
           WHERE project.id = job.project_id
             AND project.current_source_version_id = job.source_version_id
             AND project.active_job_type = 'processing'
             AND project.active_job_id = job.id
         )
         AND EXISTS (
           SELECT 1
           FROM upload_sessions AS upload
           WHERE upload.project_id = job.project_id
             AND upload.source_version_id = job.source_version_id
             AND upload.status = 'ready'
         )
       RETURNING
         id, project_id, source_version_id, project_kind, options, status,
         progress, attempt, max_attempts, next_attempt_at, lease_owner,
         lease_expires_at, error_code, correlation_id, trace_parent,
         trace_state, created_at, updated_at`,
      [id, retriedAt],
    );
    return result.rows[0] ? mapProcessingRow(result.rows[0]) : null;
  }
}

export class PostgresLayerDocumentRepository
  implements LayerDocumentRepository
{
  constructor(private readonly pool: Pool) {}

  async findBySource(
    projectId: string,
    sourceVersionId: string,
  ): Promise<LayerDocument | null> {
    const result = await this.pool.query<DocumentRow>(
      `SELECT document
       FROM layer_documents
       WHERE project_id = $1 AND source_version_id = $2`,
      [projectId, sourceVersionId],
    );
    return result.rows[0]?.document ?? null;
  }

  async findLatestByProject(projectId: string): Promise<LayerDocument | null> {
    const result = await this.pool.query<DocumentRow>(
      `SELECT document
       FROM layer_documents
       WHERE project_id = $1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [projectId],
    );
    return result.rows[0]?.document ?? null;
  }

  async findRevision(
    projectId: string,
    sourceVersionId: string,
    revision: number,
  ): Promise<LayerDocument | null> {
    const result = await this.pool.query<DocumentRow>(
      `SELECT document
       FROM layer_document_revisions
       WHERE project_id = $1
         AND source_version_id = $2
         AND revision = $3`,
      [projectId, sourceVersionId, revision],
    );
    return result.rows[0]?.document ?? null;
  }

  async save(document: LayerDocument): Promise<void> {
    if (!document.sourceVersionId) {
      throw new Error("LayerDocument requires sourceVersionId for persistence.");
    }
    const client = await this.pool.connect();
    const revision = document.revision ?? 1;
      const timestamp = document.generatedAt ?? new Date().toISOString();
      try {
        await client.query("BEGIN");
        await lockProjectForDocumentMutation(client, document.projectId);
        const current = await client.query<{
        revision: number;
        document: LayerDocument;
      }>(
        `SELECT revision, document
         FROM layer_documents
         WHERE project_id = $1 AND source_version_id = $2
         FOR UPDATE`,
        [document.projectId, document.sourceVersionId],
      );
      const previous = current.rows[0];
      if (previous) {
        await insertRevision(
          client,
          document.projectId,
          document.sourceVersionId,
          previous.revision,
          previous.document,
          timestamp,
        );
      }
      await client.query(
        `INSERT INTO layer_documents (
           project_id, source_version_id, revision, document, created_at,
           updated_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5, $5)
         ON CONFLICT (project_id, source_version_id) DO UPDATE SET
           revision = EXCLUDED.revision,
           document = EXCLUDED.document,
           updated_at = EXCLUDED.updated_at`,
        [
          document.projectId,
          document.sourceVersionId,
          revision,
          JSON.stringify(document),
          timestamp,
        ],
      );
      await insertRevision(
        client,
        document.projectId,
        document.sourceVersionId,
        revision,
        document,
        timestamp,
      );
        await pruneRevisions(
          client,
          document.projectId,
          document.sourceVersionId,
          revision,
          document,
        );
        await invalidateProjectReview(
          client,
          document.projectId,
          document.sourceVersionId,
        );
        await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async saveIfRevision(
    document: LayerDocument,
    expectedRevision: number,
  ): Promise<boolean> {
    if (!document.sourceVersionId) {
      throw new Error("LayerDocument requires sourceVersionId for persistence.");
    }
    const client = await this.pool.connect();
    const revision = document.revision ?? expectedRevision + 1;
      const updatedAt = new Date().toISOString();
      try {
        await client.query("BEGIN");
        await lockProjectForDocumentMutation(client, document.projectId);
        const current = await client.query<{
        revision: number;
        document: LayerDocument;
      }>(
        `SELECT revision, document
         FROM layer_documents
         WHERE project_id = $1 AND source_version_id = $2
         FOR UPDATE`,
        [document.projectId, document.sourceVersionId],
      );
      const previous = current.rows[0];
      if (!previous || previous.revision !== expectedRevision) {
        await client.query("ROLLBACK");
        return false;
      }
      await insertRevision(
        client,
        document.projectId,
        document.sourceVersionId,
        previous.revision,
        previous.document,
        updatedAt,
      );
      await client.query(
        `UPDATE layer_documents
         SET revision = $3, document = $4::jsonb, updated_at = $5
         WHERE project_id = $1 AND source_version_id = $2`,
        [
          document.projectId,
          document.sourceVersionId,
          revision,
          JSON.stringify(document),
          updatedAt,
        ],
      );
      await insertRevision(
        client,
        document.projectId,
        document.sourceVersionId,
        revision,
        document,
        updatedAt,
      );
        await pruneRevisions(
          client,
          document.projectId,
          document.sourceVersionId,
          revision,
          document,
        );
        await invalidateProjectReview(
          client,
          document.projectId,
          document.sourceVersionId,
        );
        await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function insertRevision(
  client: PoolClient,
  projectId: string,
  sourceVersionId: string,
  revision: number,
  document: LayerDocument,
  createdAt: string,
): Promise<void> {
  await client.query(
    `INSERT INTO layer_document_revisions (
       project_id, source_version_id, revision, document, created_at
     ) VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (project_id, source_version_id, revision) DO NOTHING`,
    [projectId, sourceVersionId, revision, JSON.stringify(document), createdAt],
  );
}

async function pruneRevisions(
  client: PoolClient,
  projectId: string,
  sourceVersionId: string,
  revision: number,
  document: LayerDocument,
): Promise<void> {
  const retained = [
    ...(document.editTimeline?.entries.map((entry) => entry.revision) ?? []),
    ...(document.editTimeline?.navigationEntries?.map(
      (entry) => entry.resultRevision,
    ) ?? []),
  ];
  await client.query(
    `DELETE FROM layer_document_revisions AS stored_revision
     WHERE stored_revision.project_id = $1
       AND stored_revision.source_version_id = $2
       AND stored_revision.revision < $3
       AND NOT (stored_revision.revision = ANY($4::integer[]))
       AND NOT EXISTS (
         SELECT 1
         FROM export_jobs AS export_job
         WHERE export_job.project_id = stored_revision.project_id
           AND export_job.source_version_id = stored_revision.source_version_id
           AND export_job.document_revision = stored_revision.revision
       )`,
    [
      projectId,
      sourceVersionId,
      Math.max(1, revision - 100),
      retained,
    ],
  );
}

async function invalidateProjectReview(
  client: PoolClient,
  projectId: string,
  sourceVersionId: string,
): Promise<void> {
  await client.query(
    `UPDATE projects
     SET current_review_approval_id = NULL,
         status = CASE
           WHEN active_job_id IS NULL THEN 'needs_review'
           ELSE status
         END,
         updated_at = now()
     WHERE id = $1 AND current_source_version_id = $2`,
    [projectId, sourceVersionId],
  );
}

async function lockProjectForDocumentMutation(
  client: PoolClient,
  projectId: string,
): Promise<void> {
  await client.query("SELECT id FROM projects WHERE id = $1 FOR UPDATE", [
    projectId,
  ]);
}

const processingSelect = `
  SELECT
    id, project_id, source_version_id, project_kind, options, status, progress,
    attempt, max_attempts, next_attempt_at, lease_owner, lease_expires_at,
    error_code, correlation_id, trace_parent, trace_state, created_at, updated_at
  FROM processing_jobs
`;
