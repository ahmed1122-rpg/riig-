import type { ExportJob, ExportJobStatus } from "@motionprep/contracts";
import type { Pool } from "pg";
import type { QueuedJobRow } from "./queued-job-row.js";

interface ExportClaimRow extends QueuedJobRow<ExportJobStatus> {
  id: string;
  project_id: string;
  source_version_id: string;
  document_revision: number;
  project_kind: ExportJob["projectKind"];
  format: ExportJob["format"];
  scope: ExportJob["scope"];
  selected_page: number | null;
  scale: ExportJob["scale"];
  color_profile: ExportJob["colorProfile"];
  naming_preset_id: string;
  artifact: ExportJob["artifact"] | null;
  correlation_id: string | null;
  trace_parent: string | null;
  trace_state: string | null;
}

type ExportQueryClient = Pick<Pool, "query">;

export async function updateExportClaim(
  database: ExportQueryClient,
  returningColumns: string,
  id: string,
  workerId: string,
  changes: Partial<ExportJob>,
  updatedAt: string,
) {
  const hasArtifact = Object.prototype.hasOwnProperty.call(changes, "artifact");
  const hasLeaseOwner = Object.prototype.hasOwnProperty.call(changes, "leaseOwner");
  const hasLeaseExpiry = Object.prototype.hasOwnProperty.call(
    changes,
    "leaseExpiresAt",
  );
  const hasErrorCode = Object.prototype.hasOwnProperty.call(changes, "errorCode");
  return database.query<ExportClaimRow>(
    `UPDATE export_jobs AS job
     SET status = COALESCE($3, status),
         progress = COALESCE($4, progress),
         artifact = CASE WHEN $5 THEN $6::jsonb ELSE artifact END,
         lease_owner = CASE WHEN $7 THEN $8 ELSE lease_owner END,
         lease_expires_at = CASE WHEN $9 THEN $10::timestamptz ELSE lease_expires_at END,
         error_code = CASE WHEN $11 THEN $12 ELSE error_code END,
         updated_at = $13
     WHERE job.id = $1
       AND job.lease_owner = $2
       AND job.status <> 'cancelled'
       AND job.lease_expires_at > $13
     RETURNING ${returningColumns}`,
    [
      id,
      workerId,
      changes.status ?? null,
      changes.progress ?? null,
      hasArtifact,
      changes.artifact ? JSON.stringify(changes.artifact) : null,
      hasLeaseOwner,
      changes.leaseOwner ?? null,
      hasLeaseExpiry,
      changes.leaseExpiresAt ?? null,
      hasErrorCode,
      changes.errorCode ?? null,
      updatedAt,
    ],
  );
}
