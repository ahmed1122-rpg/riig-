import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { normalizePostgresTextArray } from "./postgres-text-array.js";
import type {
  AccountDeletionRequest,
  PrepareAccountDeletionResult,
  ReconcileAccountDeletionResult,
} from "../../privacy/account-privacy.js";
import { rollbackTransaction, toIso } from "./database.js";
import {
  collectAccountObjectKeys,
  collectAccountObjectPrefixes,
  purgeAccountGraph,
} from "./postgres-account-deletion-graph.js";

interface DeletionRow {
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

export class PostgresAccountDeletionState {
  constructor(private readonly pool: Pool) {}

  async prepare(
    userId: string,
    requestedAt: string,
  ): Promise<PrepareAccountDeletionResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const user = await client.query(
        "SELECT deleted_at FROM users WHERE id = $1 FOR UPDATE",
        [userId],
      );
      if (!user.rows[0]) throw new Error("Account not found.");
      const active = await client.query(
        `SELECT 1 FROM subscriptions
         WHERE user_id = $1 AND provider = 'stripe'
           AND status IN ('trialing', 'active', 'past_due')
         LIMIT 1`,
        [userId],
      );
      if (active.rowCount) {
        await client.query("ROLLBACK");
        return { kind: "active_subscription" };
      }
      const existing = await client.query<DeletionRow>(
        "SELECT * FROM account_deletion_requests WHERE user_id = $1 FOR UPDATE",
        [userId],
      );
      if (existing.rows[0]?.status === "completed") {
        await client.query("COMMIT");
        return { kind: "ready", request: mapDeletion(existing.rows[0]) };
      }
      const existingPrefixes = normalizePostgresTextArray(existing.rows[0]?.object_prefixes);
      const objectPrefixes = existingPrefixes.length
        ? existingPrefixes
        : await collectAccountObjectPrefixes(client, userId);
      await client.query(
        `UPDATE users SET status = 'suspended',
             deletion_requested_at = COALESCE(deletion_requested_at, $2)
         WHERE id = $1`,
        [userId, requestedAt],
      );
      await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM mfa_enrollments WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM mfa_challenges WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [userId]);
      await cancelClaimableWork(client, userId, requestedAt);
      const drainedAt = await hasLiveLeases(client, userId, requestedAt)
        ? null
        : requestedAt;
      const saved = await client.query<DeletionRow>(
        `INSERT INTO account_deletion_requests (
           id, user_id, status, phase, object_keys, object_prefixes, attempt,
           requested_at, updated_at, drained_at
         ) VALUES ($1, $2, 'processing', 'draining', $3, $4, 1, $5, $5, $6)
         ON CONFLICT (user_id) DO UPDATE SET
           status = 'processing', attempt = account_deletion_requests.attempt + 1,
           phase = 'draining', object_prefixes = EXCLUDED.object_prefixes,
           drained_at = EXCLUDED.drained_at,
           processor_lease_id = NULL, processor_lease_expires_at = NULL,
           last_error = NULL, updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          crypto.randomUUID(), userId, existing.rows[0]?.object_keys ?? [],
          objectPrefixes, requestedAt, drainedAt,
        ],
      );
      await client.query("COMMIT");
      return { kind: "ready", request: mapDeletion(saved.rows[0]!) };
    } catch (error) {
      await rollbackTransaction(client, error);
      throw error;
    } finally {
      client.release();
    }
  }

  async listPending(limit: number): Promise<AccountDeletionRequest[]> {
    const result = await this.pool.query<DeletionRow>(
      `SELECT * FROM account_deletion_requests
       WHERE status IN ('processing', 'failed')
         AND (processor_lease_expires_at IS NULL OR processor_lease_expires_at <= now())
       ORDER BY updated_at, id LIMIT $1`,
      [Math.max(1, Math.min(limit, 100))],
    );
    return result.rows.map(mapDeletion);
  }

  async claim(
    requestId: string,
    processorLeaseId: string,
    claimedAt: string,
    expiresAt: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE account_deletion_requests
       SET processor_lease_id = $2,
           processor_lease_expires_at =
             clock_timestamp() + ($4::timestamptz - $3::timestamptz)
       WHERE id = $1 AND status <> 'completed'
         AND (processor_lease_expires_at IS NULL
           OR processor_lease_expires_at <= clock_timestamp())
         AND $4::timestamptz > $3::timestamptz`,
      [requestId, processorLeaseId, claimedAt, expiresAt],
    );
    return result.rowCount === 1;
  }

  async reconcile(
    requestId: string,
    userId: string,
    reconciledAt: string,
    processorLeaseId: string,
  ): Promise<ReconcileAccountDeletionResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<DeletionRow>(
        `SELECT * FROM account_deletion_requests
         WHERE id = $1 AND user_id = $2
           AND processor_lease_id = $3
           AND processor_lease_expires_at > clock_timestamp()
         FOR UPDATE`,
        [requestId, userId, processorLeaseId],
      );
      const current = locked.rows[0];
      if (!current) throw new Error("Account deletion processor lease was lost.");
      if (current.status === "completed") {
        await client.query("COMMIT");
        return { kind: "ready", request: mapDeletion(current) };
      }
      await cancelClaimableWork(client, userId, reconciledAt);
      if (await hasLiveLeases(client, userId, reconciledAt)) {
        const request = await updateDrainState(
          client, requestId, userId, reconciledAt, null, processorLeaseId,
        );
        await client.query("COMMIT");
        return { kind: "draining", request };
      }
      await cancelDrainedWork(client, userId, reconciledAt);
      const drainedAt = current.drained_at ? toIso(current.drained_at) : reconciledAt;
      if (
        !current.drained_at ||
        new Date(drainedAt).getTime() > new Date(reconciledAt).getTime() - 60_000
      ) {
        const request = await updateDrainState(
          client, requestId, userId, reconciledAt, drainedAt, processorLeaseId,
        );
        await client.query("COMMIT");
        return { kind: "draining", request };
      }
      const currentKeys = await collectAccountObjectKeys(client, userId);
      const currentPrefixes = normalizePostgresTextArray(current.object_prefixes);
      const objectPrefixes = currentPrefixes.length
        ? currentPrefixes
        : await collectAccountObjectPrefixes(client, userId);
      const objectKeys = [...new Set([...current.object_keys, ...currentKeys])]
        .sort((left, right) => left.localeCompare(right));
      const ready = await client.query<DeletionRow>(
        `UPDATE account_deletion_requests
         SET status = 'processing', phase = 'purging', object_keys = $3,
             object_prefixes = $4, last_error = NULL, updated_at = $5
         WHERE id = $1 AND user_id = $2 AND processor_lease_id = $6
         RETURNING *`,
        [
          requestId, userId, objectKeys, objectPrefixes, reconciledAt,
          processorLeaseId,
        ],
      );
      if (!ready.rows[0]) {
        throw new Error("Account deletion processor lease was lost.");
      }
      await client.query("COMMIT");
      return { kind: "ready", request: mapDeletion(ready.rows[0]) };
    } catch (error) {
      await rollbackTransaction(client, error);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordInventory(
    requestId: string,
    objectKeys: string[],
    recordedAt: string,
    processorLeaseId: string,
  ): Promise<AccountDeletionRequest> {
    const uniqueKeys = [...new Set(objectKeys)]
      .sort((left, right) => left.localeCompare(right));
    const digest = createHash("sha256").update(uniqueKeys.join("\0")).digest("hex");
    const result = await this.pool.query<DeletionRow>(
      `UPDATE account_deletion_requests
       SET object_keys = $2, inventory_object_count = $3,
           inventory_digest = $4, updated_at = $5
       WHERE id = $1 AND status <> 'completed' AND phase = 'purging'
         AND processor_lease_id = $6
         AND processor_lease_expires_at > clock_timestamp()
       RETURNING *`,
      [
        requestId, uniqueKeys, uniqueKeys.length, digest, recordedAt,
        processorLeaseId,
      ],
    );
    if (!result.rows[0]) throw new Error("Account deletion is not ready to purge.");
    return mapDeletion(result.rows[0]);
  }

  async markFailed(
    requestId: string,
    attemptedAt: string,
    message: string,
    processorLeaseId: string,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE account_deletion_requests
       SET status = 'failed', last_error = left($2, 1000), updated_at = $3,
           processor_lease_id = NULL, processor_lease_expires_at = NULL
       WHERE id = $1 AND status <> 'completed' AND processor_lease_id = $4`,
      [requestId, message, attemptedAt, processorLeaseId],
    );
    if (result.rowCount !== 1) {
      throw new Error("Account deletion processor lease was lost.");
    }
  }

  async complete(
    requestId: string,
    userId: string,
    completedAt: string,
    processorLeaseId: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const user = await client.query<{ email: string }>(
        "SELECT email FROM users WHERE id = $1 FOR UPDATE",
        [userId],
      );
      if (!user.rows[0]) throw new Error("Account not found.");
      const deletion = await client.query<DeletionRow>(
        `SELECT * FROM account_deletion_requests
         WHERE id = $1 AND user_id = $2 AND status <> 'completed'
           AND processor_lease_id = $3
           AND processor_lease_expires_at > clock_timestamp()
         FOR UPDATE`,
        [requestId, userId, processorLeaseId],
      );
      const request = deletion.rows[0];
      if (!request || request.phase !== "purging") {
        throw new Error("Account deletion is not ready to finalize.");
      }
      if (await hasLiveLeases(client, userId, completedAt)) {
        throw new Error("Account deletion cannot finalize while a lease is active.");
      }
      const finalKeys = await collectAccountObjectKeys(client, userId);
      const recordedKeys = new Set(request.object_keys);
      if (finalKeys.some((key) => !recordedKeys.has(key))) {
        throw new Error("Account deletion inventory changed before finalization.");
      }
      await purgeAccountGraph(client, userId, user.rows[0].email, completedAt);
      await client.query(
        `UPDATE account_deletion_requests SET status = 'completed',
             phase = 'completed', last_error = NULL, updated_at = $3,
             completed_at = $3, object_keys = '{}', object_prefixes = '{}',
             processor_lease_id = NULL, processor_lease_expires_at = NULL
         WHERE id = $1 AND user_id = $2`,
        [requestId, userId, completedAt],
      );
      await client.query("COMMIT");
    } catch (error) {
      await rollbackTransaction(client, error);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function updateDrainState(
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

async function cancelClaimableWork(
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

async function hasLiveLeases(
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

async function cancelDrainedWork(
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

function mapDeletion(row: DeletionRow): AccountDeletionRequest {
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
