import type { PoolClient } from "pg";
import type { AccountDeletionRequest } from "../../privacy/account-privacy.js";
import { toIso } from "./database.js";
import { normalizePostgresTextArray } from "./postgres-text-array.js";

export interface DeletionRow {
  id: string;
  user_id: string;
  status: AccountDeletionRequest["status"];
  phase: AccountDeletionRequest["phase"];
  object_keys: string[];
  object_prefixes: string[] | null;
  attempt: number;
  requested_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
  drained_at: Date | string | null;
  processor_lease_id: string | null;
  processor_lease_expires_at: Date | string | null;
}

export async function updateDrainState(
  client: PoolClient,
  requestId: string,
  userId: string,
  updatedAt: string,
  drainedAt: string | null,
  processorLeaseId: string,
): Promise<AccountDeletionRequest> {
  const result = await client.query<DeletionRow>(
    `UPDATE account_deletion_requests
     SET status = 'processing', phase = 'draining', drained_at = $3,
         updated_at = $4, processor_lease_id = NULL,
         processor_lease_expires_at = NULL
     WHERE id = $1 AND user_id = $2 AND processor_lease_id = $5
     RETURNING *`,
    [requestId, userId, drainedAt, updatedAt, processorLeaseId],
  );
  if (!result.rows[0]) {
    throw new Error("Account deletion processor lease was lost.");
  }
  return mapDeletion(result.rows[0]);
}

export async function cancelClaimableWork(
  client: PoolClient,
  userId: string,
  changedAt: string,
): Promise<void> {
  await client.query(
    `UPDATE malware_scan_jobs scan
     SET status = 'failed', error_code = 'ACCOUNT_DELETION',
         lease_owner = NULL, lease_expires_at = NULL,
         completed_at = $2, updated_at = $2
     FROM projects project
     WHERE project.id = scan.project_id AND project.owner_user_id = $1
       AND scan.status IN ('queued', 'retry_wait')`,
    [userId, changedAt],
  );
  await client.query(
    `UPDATE upload_sessions upload SET status = 'cancelled', updated_at = $2
     FROM projects project
     WHERE project.id = upload.project_id AND project.owner_user_id = $1
       AND upload.status IN ('validating', 'uploading', 'verifying', 'scanning')
       AND NOT EXISTS (
         SELECT 1 FROM malware_scan_jobs scan
         WHERE scan.upload_id = upload.upload_id
           AND scan.status = 'scanning'
           AND scan.lease_owner IS NOT NULL
           AND scan.lease_expires_at > $2
       )`,
    [userId, changedAt],
  );
  for (const [table, queuedStatus] of [
    ["processing_jobs", "queued"],
    ["export_jobs", "queued"],
  ] as const) {
    await client.query(
      `UPDATE ${table} job SET status = 'cancelled', lease_owner = NULL,
           lease_expires_at = NULL, updated_at = $2
       FROM projects project
       WHERE project.id = job.project_id AND project.owner_user_id = $1
         AND job.status = '${queuedStatus}'`,
      [userId, changedAt],
    );
  }
  await client.query(
    `UPDATE character_jobs job SET status = 'cancelled', lease_owner = NULL,
         lease_expires_at = NULL, updated_at = $2,
         document = job.document || jsonb_build_object(
           'status', 'cancelled', 'leaseOwner', NULL, 'leaseExpiresAt', NULL,
           'updatedAt', $2::timestamptz::text)
     FROM projects project
     WHERE project.id = job.project_id AND project.owner_user_id = $1
       AND job.status = 'queued'`,
    [userId, changedAt],
  );
}

export async function hasLiveLeases(
  client: PoolClient,
  userId: string,
  now: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM (
       SELECT 1 AS active
       FROM processing_jobs job JOIN projects project ON project.id = job.project_id
       WHERE project.owner_user_id = $1 AND job.status IN ('processing', 'verifying')
         AND job.lease_owner IS NOT NULL
         AND (job.lease_expires_at IS NULL OR job.lease_expires_at > $2)
       UNION ALL
       SELECT 1 AS active
       FROM malware_scan_jobs scan
       JOIN projects project ON project.id = scan.project_id
       WHERE project.owner_user_id = $1 AND scan.status = 'scanning'
         AND scan.lease_owner IS NOT NULL
         AND (scan.lease_expires_at IS NULL OR scan.lease_expires_at > $2)
       UNION ALL
       SELECT 1 AS active
       FROM object_write_leases lease
       WHERE lease.owner_user_id = $1
         AND lease.expires_at > clock_timestamp()
       UNION ALL
       SELECT 1 AS active
       FROM export_jobs job JOIN projects project ON project.id = job.project_id
       WHERE project.owner_user_id = $1 AND job.status IN ('generating', 'verifying')
         AND job.lease_owner IS NOT NULL
         AND (job.lease_expires_at IS NULL OR job.lease_expires_at > $2)
       UNION ALL
       SELECT 1 AS active
       FROM character_jobs job JOIN projects project ON project.id = job.project_id
       WHERE project.owner_user_id = $1 AND job.status IN ('processing', 'verifying')
         AND job.lease_owner IS NOT NULL
         AND (job.lease_expires_at IS NULL OR job.lease_expires_at > $2)
     ) lease
     LIMIT 1`,
    [userId, now],
  );
  return Boolean(result.rowCount);
}

export async function cancelDrainedWork(
  client: PoolClient,
  userId: string,
  changedAt: string,
): Promise<void> {
  for (const [table, statuses] of [
    ["processing_jobs", "'processing', 'verifying'"],
    ["export_jobs", "'generating', 'verifying'"],
  ] as const) {
    await client.query(
      `UPDATE ${table} job SET status = 'cancelled', lease_owner = NULL,
           lease_expires_at = NULL, updated_at = $2
       FROM projects project
       WHERE project.id = job.project_id AND project.owner_user_id = $1
         AND job.status IN (${statuses})`,
      [userId, changedAt],
    );
  }
  await client.query(
    `UPDATE character_jobs job SET status = 'cancelled', lease_owner = NULL,
         lease_expires_at = NULL, updated_at = $2,
         document = job.document || jsonb_build_object(
           'status', 'cancelled', 'leaseOwner', NULL, 'leaseExpiresAt', NULL,
           'updatedAt', $2::timestamptz::text)
     FROM projects project
     WHERE project.id = job.project_id AND project.owner_user_id = $1
       AND job.status IN ('processing', 'verifying')`,
    [userId, changedAt],
  );
}

export function mapDeletion(row: DeletionRow): AccountDeletionRequest {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    phase:
      row.status === "completed"
        ? "completed"
        : row.phase === "purging"
          ? "purging"
          : "draining",
    objectKeys: normalizePostgresTextArray(row.object_keys),
    objectPrefixes: normalizePostgresTextArray(row.object_prefixes),
    attempt: row.attempt,
    requestedAt: toIso(row.requested_at),
    updatedAt: toIso(row.updated_at),
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
    drainedAt: row.drained_at ? toIso(row.drained_at) : null,
  };
}
