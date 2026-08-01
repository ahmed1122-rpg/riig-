import type {
  SourceType,
  UploadSession,
  UploadStatus,
} from "@motionprep/contracts";
import { toIso } from "./database.js";

export interface UploadRow {
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

export const uploadColumns = `
  upload_id, project_id, filename, content_type, expected_size_bytes,
  status, source_version_id, sha256, object_key, expires_at, max_bytes,
  COALESCE(upload_url, demo_upload_url) AS upload_url, created_at, updated_at
`;

export function qualifiedUploadColumns(alias: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(alias)) {
    throw new Error("Invalid PostgreSQL upload column alias.");
  }
  return `
    ${alias}.upload_id, ${alias}.project_id, ${alias}.filename,
    ${alias}.content_type, ${alias}.expected_size_bytes, ${alias}.status,
    ${alias}.source_version_id, ${alias}.sha256, ${alias}.object_key,
    ${alias}.expires_at, ${alias}.max_bytes,
    COALESCE(${alias}.upload_url, ${alias}.demo_upload_url) AS upload_url,
    ${alias}.created_at, ${alias}.updated_at
  `;
}

export const uploadSelect = `SELECT ${uploadColumns} FROM upload_sessions`;

export function mapUpload(row: UploadRow): UploadSession {
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
