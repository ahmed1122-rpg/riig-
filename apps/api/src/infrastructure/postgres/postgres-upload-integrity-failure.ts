import type { Pool, PoolClient } from "pg";
import type {
  MarkUploadIntegrityFailureInput,
  MarkUploadIntegrityFailureResult,
  UploadIntegrityFailureCommand,
} from "../../uploads/upload-integrity-failure.js";
import {
  uploadSelect,
  type UploadRow,
} from "./postgres-upload-record.js";

interface SourceRow {
  id: string;
}

interface ProjectStateRow {
  current_source_version_id: string | null;
  status: string;
}

export interface UploadIntegrityFailureTestHooks {
  afterUploadUpdated?(client: PoolClient): Promise<void>;
}

export class PostgresUploadIntegrityFailureCommand
  implements UploadIntegrityFailureCommand
{
  constructor(
    private readonly pool: Pool,
    private readonly testHooks: UploadIntegrityFailureTestHooks = {},
  ) {}

  async markIntegrityFailure(
    input: MarkUploadIntegrityFailureInput,
  ): Promise<MarkUploadIntegrityFailureResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await this.lockUpload(client, input.session.uploadId);
      if (!current || !matchesIdentity(current, input)) {
        await client.query("ROLLBACK");
        return { outcome: "stale_candidate" };
      }
      if (["failed", "cancelled"].includes(current.status)) {
        await client.query("COMMIT");
        return { outcome: "already_terminal" };
      }
      if (!matchesObservation(current, input)) {
        await client.query("ROLLBACK");
        return { outcome: "stale_candidate" };
      }

      const source = await this.lockSource(client, current.source_version_id);
      const project = await this.lockProject(client, current.project_id);
      const failedAt = new Date().toISOString();
      const changed = await client.query(
        `
          UPDATE upload_sessions
          SET status = 'failed',
              integrity_failure_code = $2,
              integrity_failed_at = $3,
              integrity_observed_content_type = $4,
              integrity_observed_size_bytes = $5,
              integrity_observed_sha256 = $6,
              updated_at = $3
          WHERE upload_id = $1
            AND status IN ('verifying', 'ready')
        `,
        [
          current.upload_id,
          input.code,
          failedAt,
          input.observed?.contentType ?? null,
          input.observed?.sizeBytes ?? null,
          input.observed?.sha256.toLowerCase() ?? null,
        ],
      );
      if (changed.rowCount !== 1) {
        throw new Error("Upload integrity transition did not update one row.");
      }
      await this.testHooks.afterUploadUpdated?.(client);

      if (source) {
        await client.query(
          `UPDATE source_versions
           SET status = 'failed', updated_at = $2
           WHERE id = $1`,
          [source.id, failedAt],
        );
      }

      const mayFailProject =
        project.current_source_version_id === current.source_version_id ||
        (project.current_source_version_id === null &&
          ["draft", "validating", "uploading", "queued"].includes(
            project.status,
          ));
      if (mayFailProject && project.status !== "cancelled") {
        await client.query(
          `UPDATE projects
           SET status = 'failed',
               active_job_type = NULL,
               active_job_id = NULL,
               updated_at = $2
           WHERE id = $1`,
          [current.project_id, failedAt],
        );
      }

      if (current.source_version_id) {
        await client.query(
          `UPDATE processing_jobs
           SET status = 'failed',
               lease_owner = NULL,
               lease_expires_at = NULL,
               error_code = $3,
               updated_at = $4
           WHERE project_id = $1
             AND source_version_id = $2
             AND status IN ('queued', 'processing', 'verifying')`,
          [
            current.project_id,
            current.source_version_id,
            input.code,
            failedAt,
          ],
        );
        await client.query(
          `UPDATE export_jobs
           SET status = 'failed',
               lease_owner = NULL,
               lease_expires_at = NULL,
               error_code = $3,
               updated_at = $4
           WHERE project_id = $1
             AND source_version_id = $2
             AND status IN ('queued', 'generating', 'verifying')`,
          [
            current.project_id,
            current.source_version_id,
            input.code,
            failedAt,
          ],
        );
      }

      await client.query(
        `INSERT INTO upload_integrity_events (
           id, upload_id, project_id, source_version_id, failure_code,
           observed_content_type, observed_size_bytes, observed_sha256,
           created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (upload_id) DO NOTHING`,
        [
          crypto.randomUUID(),
          current.upload_id,
          current.project_id,
          current.source_version_id,
          input.code,
          input.observed?.contentType ?? null,
          input.observed?.sizeBytes ?? null,
          input.observed?.sha256.toLowerCase() ?? null,
          failedAt,
        ],
      );
      await client.query("COMMIT");
      return { outcome: "transitioned" };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockUpload(
    client: PoolClient,
    uploadId: string,
  ): Promise<UploadRow | null> {
    const result = await client.query<UploadRow>(
      `${uploadSelect} WHERE upload_id = $1 FOR UPDATE`,
      [uploadId],
    );
    return result.rows[0] ?? null;
  }

  private async lockSource(
    client: PoolClient,
    sourceVersionId: string | null,
  ): Promise<SourceRow | null> {
    if (!sourceVersionId) return null;
    const result = await client.query<SourceRow>(
      "SELECT id FROM source_versions WHERE id = $1 FOR UPDATE",
      [sourceVersionId],
    );
    return result.rows[0] ?? null;
  }

  private async lockProject(
    client: PoolClient,
    projectId: string,
  ): Promise<ProjectStateRow> {
    const result = await client.query<ProjectStateRow>(
      `SELECT current_source_version_id, status
       FROM projects WHERE id = $1 FOR UPDATE`,
      [projectId],
    );
    const project = result.rows[0];
    if (!project) throw new Error("Upload project no longer exists.");
    return project;
  }
}

function matchesIdentity(
  current: UploadRow,
  input: MarkUploadIntegrityFailureInput,
): boolean {
  return (
    current.project_id === input.session.projectId &&
    current.source_version_id === input.session.sourceVersionId
  );
}

function matchesObservation(
  current: UploadRow,
  input: MarkUploadIntegrityFailureInput,
): boolean {
  return (
    ["verifying", "ready"].includes(current.status) &&
    current.status === input.session.status &&
    normalizedHash(current.sha256) === normalizedHash(input.session.sha256)
  );
}

function normalizedHash(value: string | null): string | null {
  return value?.toLowerCase() ?? null;
}
