import type { ProjectStatus } from "@motionprep/contracts";
import type { Pool, PoolClient } from "pg";
import type {
  CancelUploadInput,
  CancelUploadResult,
  UploadCancellationCommand,
} from "../../uploads/upload-cancellation.js";
import {
  mapUpload,
  uploadColumns,
  type UploadRow,
} from "./postgres-upload-record.js";

interface CancellationUploadRow extends UploadRow {
  project_status_before_upload: ProjectStatus | null;
}

interface SourceRow {
  id: string;
  project_id: string;
  upload_id: string;
}

interface ProjectRow {
  current_source_version_id: string | null;
  status: ProjectStatus;
}

export interface UploadCancellationTestHooks {
  afterUploadUpdated?(client: PoolClient): Promise<void>;
}

export class PostgresUploadCancellationCommand
  implements UploadCancellationCommand
{
  constructor(
    private readonly pool: Pool,
    private readonly testHooks: UploadCancellationTestHooks = {},
  ) {}

  async cancel(input: CancelUploadInput): Promise<CancelUploadResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await this.lockUpload(client, input.session.uploadId);
      if (!current || !matchesIdentity(current, input)) {
        await client.query("ROLLBACK");
        return { outcome: "stale_session" };
      }
      if (current.status === "ready") {
        await client.query("COMMIT");
        return { outcome: "already_published", session: mapUpload(current) };
      }

      const alreadyCancelled = current.status === "cancelled";
      const source = await this.lockSource(client, current);
      const project = await this.lockProject(client, current.project_id);
      let cancelled = current;
      if (!alreadyCancelled) {
        const result = await client.query<CancellationUploadRow>(
          `
            UPDATE upload_sessions
            SET status = 'cancelled', updated_at = now()
            WHERE upload_id = $1 AND status <> 'ready'
            RETURNING ${uploadColumns}, project_status_before_upload
          `,
          [current.upload_id],
        );
        const updated = result.rows[0];
        if (!updated) {
          throw new Error("Upload cancellation did not update one row.");
        }
        cancelled = updated;
      }
      await this.testHooks.afterUploadUpdated?.(client);

      if (source && source.status !== "cancelled") {
        await client.query(
          `UPDATE source_versions
           SET status = 'cancelled', updated_at = now()
           WHERE id = $1`,
          [source.id],
        );
      }

      if (await this.mayRestoreProject(client, current, project)) {
        const baseline =
          current.project_status_before_upload ??
          fallbackProjectStatus(project.current_source_version_id);
        await client.query(
          `
            UPDATE projects
            SET status = $3,
                current_source_version_id = CASE
                  WHEN current_source_version_id = $2 THEN NULL
                  ELSE current_source_version_id END,
                current_review_approval_id = CASE
                  WHEN current_source_version_id = $2 THEN NULL
                  ELSE current_review_approval_id END,
                active_job_type = NULL,
                active_job_id = NULL,
                updated_at = now()
            WHERE id = $1
              AND status IN ('validating', 'uploading')
          `,
          [current.project_id, current.source_version_id, baseline],
        );
      }

      await client.query("COMMIT");
      return {
        outcome: alreadyCancelled ? "already_cancelled" : "cancelled",
        session: mapUpload(cancelled),
      };
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
  ): Promise<CancellationUploadRow | null> {
    const result = await client.query<CancellationUploadRow>(
      `SELECT ${uploadColumns}, project_status_before_upload
       FROM upload_sessions WHERE upload_id = $1 FOR UPDATE`,
      [uploadId],
    );
    return result.rows[0] ?? null;
  }

  private async lockSource(
    client: PoolClient,
    upload: CancellationUploadRow,
  ): Promise<(SourceRow & { status: string }) | null> {
    if (!upload.source_version_id) return null;
    const result = await client.query<SourceRow & { status: string }>(
      `SELECT id, project_id, upload_id, status
       FROM source_versions WHERE id = $1 FOR UPDATE`,
      [upload.source_version_id],
    );
    const source = result.rows[0];
    if (
      source &&
      (source.project_id !== upload.project_id ||
        source.upload_id !== upload.upload_id)
    ) {
      throw new Error("Upload source version does not match its session.");
    }
    return source ?? null;
  }

  private async lockProject(
    client: PoolClient,
    projectId: string,
  ): Promise<ProjectRow> {
    const result = await client.query<ProjectRow>(
      `SELECT current_source_version_id, status
       FROM projects WHERE id = $1 FOR UPDATE`,
      [projectId],
    );
    const project = result.rows[0];
    if (!project) throw new Error("Upload project no longer exists.");
    return project;
  }

  private async mayRestoreProject(
    client: PoolClient,
    upload: CancellationUploadRow,
    project: ProjectRow,
  ): Promise<boolean> {
    if (!["validating", "uploading"].includes(project.status)) return false;
    const result = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM upload_sessions
         WHERE project_id = $1
           AND upload_id <> $2
           AND status IN ('validating', 'uploading', 'verifying')
       ) AS exists`,
      [upload.project_id, upload.upload_id],
    );
    return result.rows[0]?.exists !== true;
  }
}

function matchesIdentity(
  current: CancellationUploadRow,
  input: CancelUploadInput,
): boolean {
  return (
    current.project_id === input.session.projectId &&
    current.source_version_id === input.session.sourceVersionId
  );
}

function fallbackProjectStatus(
  currentSourceVersionId: string | null,
): ProjectStatus {
  return currentSourceVersionId ? "needs_review" : "draft";
}
