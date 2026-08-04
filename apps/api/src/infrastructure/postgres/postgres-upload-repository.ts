import type {
  ProjectStatus,
  UploadSession,
} from "@motionprep/contracts";
import type { Pool } from "pg";
import type {
  SaveUploadOptions,
  UploadStatusSummary,
  UploadRepository,
} from "../../uploads/upload-repository.js";
import {
  mapUpload,
  uploadSelect,
  type UploadRow,
} from "./postgres-upload-record.js";

export class PostgresUploadRepository implements UploadRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<UploadSession | null> {
    const result = await this.pool.query<UploadRow>(
      `${uploadSelect} WHERE upload_id = $1`,
      [id],
    );
    return result.rows[0] ? mapUpload(result.rows[0]) : null;
  }

  async findActiveByProject(
    projectId: string,
  ): Promise<UploadSession | null> {
    const result = await this.pool.query<UploadRow>(
      `
        ${uploadSelect}
        WHERE project_id = $1
          AND status IN ('validating', 'uploading', 'verifying')
          AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [projectId],
    );
    return result.rows[0] ? mapUpload(result.rows[0]) : null;
  }

  async findReadyBySourceVersion(
    projectId: string,
    sourceVersionId: string,
  ): Promise<UploadSession | null> {
    const result = await this.pool.query<UploadRow>(
      `
        ${uploadSelect}
        WHERE project_id = $1
          AND source_version_id = $2
          AND status = 'ready'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [projectId, sourceVersionId],
    );
    return result.rows[0] ? mapUpload(result.rows[0]) : null;
  }

  async findExpiredActiveByProject(
    projectId: string,
    expiredAt: string,
  ): Promise<UploadSession[]> {
    const result = await this.pool.query<UploadRow>(
      `
        ${uploadSelect}
        WHERE project_id = $1
          AND status IN ('validating', 'uploading', 'verifying')
          AND expires_at <= $2
        ORDER BY expires_at, upload_id
      `,
      [projectId, expiredAt],
    );
    return result.rows.map(mapUpload);
  }

  async findProjectStatusBeforeUpload(
    uploadId: string,
  ): Promise<ProjectStatus | null> {
    const result = await this.pool.query<{
      project_status_before_upload: ProjectStatus | null;
    }>(
      `SELECT project_status_before_upload
       FROM upload_sessions
       WHERE upload_id = $1`,
      [uploadId],
    );
    return result.rows[0]?.project_status_before_upload ?? null;
  }

  async list(): Promise<UploadSession[]> {
    const result = await this.pool.query<UploadRow>(
      `${uploadSelect} ORDER BY created_at DESC`,
    );
    return result.rows.map(mapUpload);
  }

  async summarizeStatuses(): Promise<UploadStatusSummary> {
    const result = await this.pool.query<{
      total: string | number;
      active: string | number;
      failed: string | number;
    }>(`SELECT
          count(*) AS total,
          count(*) FILTER (
            WHERE status IN ('validating', 'uploading', 'verifying')
          ) AS active,
          count(*) FILTER (WHERE status = 'failed') AS failed
        FROM upload_sessions`);
    const row = result.rows[0];
    return {
      total: Number(row?.total ?? 0),
      active: Number(row?.active ?? 0),
      failed: Number(row?.failed ?? 0),
    };
  }

  async markObjectPurged(uploadId: string, purgedAt: string): Promise<void> {
    await this.pool.query(
      `UPDATE upload_sessions
       SET object_purged_at = COALESCE(object_purged_at, $2),
           updated_at = GREATEST(updated_at, $2)
       WHERE upload_id = $1 AND status IN ('failed', 'cancelled')`,
      [uploadId, purgedAt],
    );
  }

  async save(
    session: UploadSession,
    options: SaveUploadOptions = {},
  ): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO upload_sessions (
          upload_id, project_id, filename, content_type, expected_size_bytes,
          status, source_version_id, sha256, object_key, expires_at, max_bytes,
          demo_upload_url, upload_url, project_status_before_upload,
          created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12,
          $13, $14, $15
        )
        ON CONFLICT (upload_id) DO UPDATE SET
          status = EXCLUDED.status,
          source_version_id = EXCLUDED.source_version_id,
          sha256 = EXCLUDED.sha256,
          expires_at = EXCLUDED.expires_at,
          updated_at = EXCLUDED.updated_at
      `,
      [
        session.uploadId,
        session.projectId,
        session.filename,
        session.contentType,
        session.expectedSizeBytes,
        session.status,
        session.sourceVersionId,
        session.sha256,
        session.objectKey,
        session.expiresAt,
        session.maxBytes,
        session.uploadUrl,
        options.projectStatusBeforeUpload ?? null,
        session.createdAt,
        session.updatedAt,
      ],
    );
  }
}
