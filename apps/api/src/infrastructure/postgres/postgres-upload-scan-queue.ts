import type { Pool } from "pg";
import type {
  QueueVerifiedUploadScanInput,
  UploadScanQueueCommand,
} from "../../uploads/upload-scan-queue.js";
import {
  mapUpload,
  uploadColumns,
  uploadSelect,
  type UploadRow,
} from "./postgres-upload-record.js";
import { lockUploadProject } from "./postgres-upload-project-lock.js";

interface SourceRow {
  id: string;
  project_id: string;
  upload_id: string;
}

export class PostgresUploadScanQueueCommand implements UploadScanQueueCommand {
  constructor(private readonly pool: Pool) {}

  async enqueue(input: QueueVerifiedUploadScanInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const uploadResult = await client.query<UploadRow>(
        `${uploadSelect} WHERE upload_id = $1 FOR UPDATE`,
        [input.session.uploadId],
      );
      const current = uploadResult.rows[0];
      if (
        !current ||
        current.project_id !== input.session.projectId ||
        current.source_version_id !== input.session.sourceVersionId ||
        ["failed", "cancelled", "rejected", "scan_failed"].includes(
          current.status,
        )
      ) {
        throw new Error("Verified upload metadata no longer matches its session.");
      }
      if (!current.source_version_id) {
        throw new Error("Upload session is missing its source version.");
      }
      const sourceResult = await client.query<SourceRow>(
        `SELECT id, project_id, upload_id FROM source_versions
         WHERE id = $1 FOR UPDATE`,
        [current.source_version_id],
      );
      const source = sourceResult.rows[0];
      if (
        !source ||
        source.project_id !== current.project_id ||
        source.upload_id !== current.upload_id
      ) {
        throw new Error("Upload source version does not match its session.");
      }
      await lockUploadProject(client, current.project_id);
      const scanning = await client.query<UploadRow>(
        `UPDATE upload_sessions
         SET status = 'scanning', sha256 = $2,
             malware_scan_verdict = 'pending', updated_at = now()
         WHERE upload_id = $1
         RETURNING ${uploadColumns}`,
        [current.upload_id, input.sha256.toLowerCase()],
      );
      await client.query(
        `UPDATE source_versions
         SET status = 'scanning', sha256 = $2,
             malware_scan_verdict = 'pending', updated_at = now()
         WHERE id = $1`,
        [source.id, input.sha256.toLowerCase()],
      );
      await client.query(
        `INSERT INTO malware_scan_jobs (
           id, upload_id, project_id, source_version_id, object_key,
           quarantine_object_key,
           content_type, size_bytes, sha256, status, next_attempt_at,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $5, $6, $7, $8, 'queued', now(), now(), now()
         )
         ON CONFLICT (upload_id) DO UPDATE SET
           object_key = EXCLUDED.object_key,
           quarantine_object_key = EXCLUDED.quarantine_object_key,
           content_type = EXCLUDED.content_type,
           size_bytes = EXCLUDED.size_bytes,
           sha256 = EXCLUDED.sha256,
           status = CASE
             WHEN malware_scan_jobs.status = 'clean' THEN 'clean'
             ELSE 'queued'
           END,
           next_attempt_at = now(),
           updated_at = now()`,
        [
          crypto.randomUUID(),
          current.upload_id,
          current.project_id,
          source.id,
          current.object_key,
          current.content_type,
          current.expected_size_bytes,
          input.sha256.toLowerCase(),
        ],
      );
      const row = scanning.rows[0];
      if (!row) throw new Error("PostgreSQL did not queue the upload scan.");
      await client.query("COMMIT");
      return mapUpload(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
