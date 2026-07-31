import type {
  SourceType,
  UploadSession,
  UploadStatus,
} from "@motionprep/contracts";
import type { Pool } from "pg";
import type { UploadRepository } from "../../uploads/upload-repository.js";
import { toIso } from "./database.js";

interface UploadRow {
  upload_id: string;
  project_id: string;
  filename: string;
  content_type: SourceType;
  expected_size_bytes: number;
  status: UploadStatus;
  source_version_id: string | null;
  sha256: string | null;
  object_key: string;
  expires_at: Date | string;
  max_bytes: number;
  upload_url: string;
  created_at: Date | string;
  updated_at: Date | string;
}

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

  async expireActiveByProject(
    projectId: string,
    expiredAt: string,
  ): Promise<UploadSession[]> {
    const result = await this.pool.query<UploadRow>(
      `
        UPDATE upload_sessions
        SET status = 'cancelled', updated_at = $2
        WHERE project_id = $1
          AND status IN ('validating', 'uploading', 'verifying')
          AND expires_at <= $2
        RETURNING ${uploadColumns}
      `,
      [projectId, expiredAt],
    );
    return result.rows.map(mapUpload);
  }

  async list(): Promise<UploadSession[]> {
    const result = await this.pool.query<UploadRow>(
      `${uploadSelect} ORDER BY created_at DESC`,
    );
    return result.rows.map(mapUpload);
  }

  async save(session: UploadSession): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO upload_sessions (
          upload_id, project_id, filename, content_type, expected_size_bytes,
          status, source_version_id, sha256, object_key, expires_at, max_bytes,
          demo_upload_url, upload_url, created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13, $14
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
        session.createdAt,
        session.updatedAt,
      ],
    );
  }
}

const uploadColumns = `
  upload_id, project_id, filename, content_type, expected_size_bytes,
  status, source_version_id, sha256, object_key, expires_at, max_bytes,
  COALESCE(upload_url, demo_upload_url) AS upload_url, created_at, updated_at
`;

const uploadSelect = `SELECT ${uploadColumns} FROM upload_sessions`;

function mapUpload(row: UploadRow): UploadSession {
  return {
    uploadId: row.upload_id,
    projectId: row.project_id,
    filename: row.filename,
    contentType: row.content_type,
    expectedSizeBytes: row.expected_size_bytes,
    status: row.status,
    sourceVersionId: row.source_version_id,
    sha256: row.sha256,
    objectKey: row.object_key,
    expiresAt: toIso(row.expires_at),
    maxBytes: row.max_bytes,
    uploadUrl: row.upload_url,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}
