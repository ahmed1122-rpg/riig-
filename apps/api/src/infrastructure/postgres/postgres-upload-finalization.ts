import type { Pool, PoolClient } from "pg";
import type {
  FinalizeVerifiedUploadInput,
  UploadFinalizationCommand,
} from "../../uploads/upload-finalization.js";
import {
  mapUpload,
  qualifiedUploadColumns,
  uploadColumns,
  uploadSelect,
  type UploadRow,
} from "./postgres-upload-record.js";

interface SourceRow {
  id: string;
  project_id: string;
  upload_id: string;
}

interface ProjectStateRow {
  current_source_version_id: string | null;
  status: string;
}

export interface UploadFinalizationTestHooks {
  afterUploadUpdated?(client: PoolClient): Promise<void>;
}

export class PostgresUploadFinalizationCommand
  implements UploadFinalizationCommand
{
  constructor(
    private readonly pool: Pool,
    private readonly testHooks: UploadFinalizationTestHooks = {},
  ) {}

  async finalize(input: FinalizeVerifiedUploadInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await this.lockUpload(client, input);
      const source = await this.lockSource(client, current);
      const project = await this.lockProject(client, current.project_id);
      const published = await client.query<UploadRow>(
        `
          UPDATE upload_sessions
          SET status = 'ready', sha256 = $2, updated_at = now()
          WHERE upload_id = $1
          RETURNING ${uploadColumns}
        `,
        [current.upload_id, input.sha256.toLowerCase()],
      );
      await this.testHooks.afterUploadUpdated?.(client);
      await client.query(
        `
          UPDATE source_versions
          SET status = 'ready', sha256 = $2, updated_at = now()
          WHERE id = $1
        `,
        [source.id, input.sha256.toLowerCase()],
      );

      const isUploadTransition = [
        "draft",
        "validating",
        "uploading",
        "failed",
        "cancelled",
      ].includes(project.status);
      const mayPublishAsCurrent =
        project.current_source_version_id === source.id || isUploadTransition;
      await client.query(
        `
          UPDATE projects
          SET current_source_version_id = CASE
                WHEN $3 THEN $2 ELSE current_source_version_id END,
              status = CASE WHEN $4 THEN 'queued' ELSE status END,
              active_job_type = CASE WHEN $4 THEN NULL ELSE active_job_type END,
              active_job_id = CASE WHEN $4 THEN NULL ELSE active_job_id END,
              updated_at = CASE WHEN $3 OR $4
                THEN now() ELSE updated_at END
          WHERE id = $1
        `,
        [
          current.project_id,
          source.id,
          mayPublishAsCurrent,
          isUploadTransition,
        ],
      );
      const row = published.rows[0];
      if (!row) throw new Error("PostgreSQL did not publish the verified upload.");
      await client.query("COMMIT");
      return mapUpload(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findCandidates(limit: number) {
    const result = await this.pool.query<UploadRow>(
      `
        SELECT ${qualifiedUploadColumns("upload")}
        FROM upload_sessions AS upload
        LEFT JOIN source_versions AS source
          ON source.id = upload.source_version_id
        LEFT JOIN projects AS project
          ON project.id = upload.project_id
        WHERE upload.status IN ('verifying', 'ready')
          AND (
            upload.status = 'verifying'
            OR source.id IS NULL
            OR source.status <> 'ready'
            OR source.sha256 IS DISTINCT FROM upload.sha256
            OR project.id IS NULL
            OR (
              project.current_source_version_id IS DISTINCT FROM source.id
              AND project.status IN (
                'draft', 'validating', 'uploading', 'failed', 'cancelled'
              )
            )
          )
        ORDER BY upload.updated_at, upload.upload_id
        LIMIT $1
      `,
      [Math.min(Math.max(1, limit), 500)],
    );
    return result.rows.map(mapUpload);
  }

  private async lockUpload(
    client: PoolClient,
    input: FinalizeVerifiedUploadInput,
  ): Promise<UploadRow> {
    const result = await client.query<UploadRow>(
      `${uploadSelect} WHERE upload_id = $1 FOR UPDATE`,
      [input.session.uploadId],
    );
    const current = result.rows[0];
    if (
      !current ||
      current.project_id !== input.session.projectId ||
      current.source_version_id !== input.session.sourceVersionId ||
      ["failed", "cancelled"].includes(current.status)
    ) {
      throw new Error("Verified upload metadata no longer matches its session.");
    }
    return current;
  }

  private async lockSource(
    client: PoolClient,
    upload: UploadRow,
  ): Promise<SourceRow> {
    if (!upload.source_version_id) {
      throw new Error("Upload session is missing its source version.");
    }
    const result = await client.query<SourceRow>(
      `
        SELECT id, project_id, upload_id
        FROM source_versions
        WHERE id = $1
        FOR UPDATE
      `,
      [upload.source_version_id],
    );
    const source = result.rows[0];
    if (
      !source ||
      source.project_id !== upload.project_id ||
      source.upload_id !== upload.upload_id
    ) {
      throw new Error("Upload source version does not match its session.");
    }
    return source;
  }

  private async lockProject(
    client: PoolClient,
    projectId: string,
  ): Promise<ProjectStateRow> {
    const result = await client.query<ProjectStateRow>(
      `
        SELECT current_source_version_id, status
        FROM projects
        WHERE id = $1
        FOR UPDATE
      `,
      [projectId],
    );
    const project = result.rows[0];
    if (!project) throw new Error("Upload project no longer exists.");
    return project;
  }
}
