import type { ExportJob } from "@motionprep/contracts";
import type { Pool } from "pg";
import {
  exportReturningColumns,
} from "./postgres-export-columns.js";
import { mapExportRow as mapExport, type ExportRow } from "./postgres-export-row.js";
import { availableProjectWorkFenceSql } from "./postgres-project-work-fence.js";

export async function retryFailedExport(
  pool: Pool,
  id: string,
  retriedAt: string,
  _activateProject?: (job: ExportJob) => Promise<boolean>,
): Promise<ExportJob | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<ExportRow>(
      `UPDATE export_jobs AS job
     SET status = 'queued',
         progress = 0,
         attempt = 0,
         next_attempt_at = $2,
         lease_owner = NULL,
         lease_expires_at = NULL,
         error_code = NULL,
         artifact = NULL,
         updated_at = $2
     WHERE job.id = $1
       AND job.status = 'failed'
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
       AND EXISTS (
         SELECT 1
         FROM upload_sessions AS upload
         WHERE upload.project_id = job.project_id
           AND upload.source_version_id = job.source_version_id
           AND upload.status = 'ready'
       )
       AND EXISTS (
         SELECT 1
         FROM layer_document_revisions AS revision
         WHERE revision.project_id = job.project_id
           AND revision.source_version_id = job.source_version_id
           AND revision.revision = job.document_revision
       )
       AND EXISTS (
         SELECT 1
         FROM projects AS approved_project
         JOIN project_review_approvals AS approval
           ON approval.id = approved_project.current_review_approval_id
         WHERE approved_project.id = job.project_id
           AND approval.source_version_id = job.source_version_id
           AND approval.document_revision = job.document_revision
       )
     RETURNING ${exportReturningColumns}`,
      [id, retriedAt],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }
    const activated = await client.query(
      `UPDATE projects
       SET status = 'exporting',
           active_job_type = 'export',
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
         )
         AND EXISTS (
           SELECT 1 FROM project_review_approvals AS approval
           WHERE approval.id = projects.current_review_approval_id
             AND approval.source_version_id = $2
             AND approval.document_revision = $5
         )`,
      [
        row.project_id,
        row.source_version_id,
        row.id,
        retriedAt,
        row.document_revision,
      ],
    );
    if (activated.rowCount !== 1) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query("COMMIT");
    return mapExport(row);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
