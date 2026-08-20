import type { LayerDocument } from "@motionprep/contracts";
import type { Pool, PoolClient } from "pg";
import type { LayerDocumentRepository } from "../../processing/processing-repository.js";

interface DocumentRow {
  document: LayerDocument;
}

export class PostgresLayerDocumentRepository
  implements LayerDocumentRepository
{
  readonly settlesProjectReviewAtomically = true;

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
        const sourceIsCurrent = await lockProjectForDocumentMutation(
          client,
          document.projectId,
          document.sourceVersionId,
        );
        if (!sourceIsCurrent) {
          throw new Error("LayerDocument source is no longer current.");
        }
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
        const sourceIsCurrent = await lockProjectForDocumentMutation(
          client,
          document.projectId,
          document.sourceVersionId,
        );
        if (!sourceIsCurrent) {
          await client.query("ROLLBACK");
          return false;
        }
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
  sourceVersionId: string,
): Promise<boolean> {
  const result = await client.query<{ current_source_version_id: string | null }>(
    `SELECT current_source_version_id
     FROM projects
     WHERE id = $1
     FOR UPDATE`,
    [projectId],
  );
  return result.rows[0]?.current_source_version_id === sourceVersionId;
}
