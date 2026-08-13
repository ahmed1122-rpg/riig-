import type { Pool } from "pg";
import type { RetentionConfig } from "./retention-config.js";

export interface RetentionDatabaseCounts {
  sessions: number;
  mfaEnrollments: number;
  mfaChallenges: number;
  passwordResetTokens: number;
  emailVerificationTokens: number;
  emailOutbox: number;
  idempotencyKeys: number;
  objectWriteLeases: number;
  checkoutSessionsCancelled: number;
  workerHeartbeats: number;
  workerEvents: number;
  usageLedgerEvents: number;
  auditEvents: number;
  processingJobs: number;
  exportJobs: number;
  uploadSessions: number;
  sourceVersions: number;
  uploadIntegrityEvents: number;
  characterJobs: number;
}

export async function pruneRetentionDatabase(
  pool: Pool,
  now: string,
  config: RetentionConfig,
): Promise<RetentionDatabaseCounts> {
  const jobCutoff = daysBefore(now, config.JOB_RETENTION_DAYS);
  const auditCutoff = daysBefore(now, config.AUDIT_RETENTION_DAYS);
  const usageCutoff = daysBefore(now, config.USAGE_LEDGER_RETENTION_DAYS);
  const heartbeatCutoff = daysBefore(
    now,
    config.WORKER_HEARTBEAT_RETENTION_DAYS,
  );
  const workerEventCutoff = daysBefore(
    now,
    config.WORKER_EVENT_RETENTION_DAYS,
  );
  const client = await pool.connect();
  const count = async (sql: string, values: unknown[]) => {
    const result = await client.query(sql, values);
    return result.rowCount ?? 0;
  };

  try {
    await client.query("BEGIN");
    const counts = {
      sessions: await count(
        `DELETE FROM sessions WHERE ctid IN (
          SELECT ctid FROM sessions WHERE expires_at <= $1 LIMIT $2
        )`,
        [now, config.RETENTION_BATCH_SIZE],
      ),
      mfaEnrollments: await count(
        `DELETE FROM mfa_enrollments WHERE ctid IN (
          SELECT ctid FROM mfa_enrollments WHERE expires_at <= $1 LIMIT $2
        )`,
        [now, config.RETENTION_BATCH_SIZE],
      ),
      mfaChallenges: await count(
        `DELETE FROM mfa_challenges WHERE ctid IN (
          SELECT ctid FROM mfa_challenges WHERE expires_at <= $1 LIMIT $2
        )`,
        [now, config.RETENTION_BATCH_SIZE],
      ),
      passwordResetTokens: await count(
        `DELETE FROM password_reset_tokens WHERE ctid IN (
          SELECT ctid FROM password_reset_tokens
          WHERE expires_at <= $1 LIMIT $2
        )`,
        [now, config.RETENTION_BATCH_SIZE],
      ),
      emailVerificationTokens: await count(
        `DELETE FROM email_verification_tokens WHERE ctid IN (
          SELECT ctid FROM email_verification_tokens
          WHERE expires_at <= $1 LIMIT $2
        )`,
        [now, config.RETENTION_BATCH_SIZE],
      ),
      emailOutbox: await count(
        `DELETE FROM email_outbox WHERE ctid IN (
          SELECT ctid FROM email_outbox
          WHERE status IN ('sent', 'failed')
            AND updated_at <= $1::timestamptz - interval '7 days'
          LIMIT $2
        )`,
        [now, config.RETENTION_BATCH_SIZE],
      ),
      idempotencyKeys: await count(
        `DELETE FROM idempotency_keys WHERE ctid IN (
          SELECT ctid FROM idempotency_keys WHERE expires_at <= $1 LIMIT $2
        )`,
        [now, config.RETENTION_BATCH_SIZE],
      ),
      objectWriteLeases: await count(
        `DELETE FROM object_write_leases WHERE ctid IN (
          SELECT ctid FROM object_write_leases
          WHERE expires_at <= $1 LIMIT $2
        )`,
        [now, config.RETENTION_BATCH_SIZE],
      ),
      checkoutSessionsCancelled: await count(
        `UPDATE checkout_sessions
         SET status = 'cancelled'
         WHERE ctid IN (
           SELECT ctid FROM checkout_sessions
           WHERE expires_at <= $1
             AND status IN ('pending', 'redirect_required')
           LIMIT $2
         )`,
        [now, config.RETENTION_BATCH_SIZE],
      ),
      workerHeartbeats: await count(
        `DELETE FROM worker_heartbeats WHERE ctid IN (
          SELECT ctid FROM worker_heartbeats WHERE last_seen_at <= $1 LIMIT $2
        )`,
        [heartbeatCutoff, config.RETENTION_BATCH_SIZE],
      ),
      workerEvents: await count(
        `DELETE FROM worker_events WHERE ctid IN (
          SELECT ctid FROM worker_events WHERE created_at <= $1 LIMIT $2
        )`,
        [workerEventCutoff, config.RETENTION_BATCH_SIZE],
      ),
      usageLedgerEvents: await count(
        `DELETE FROM usage_ledger WHERE ctid IN (
          SELECT ctid FROM usage_ledger WHERE created_at <= $1 LIMIT $2
        )`,
        [usageCutoff, config.RETENTION_BATCH_SIZE],
      ),
      auditEvents: await count(
        `DELETE FROM audit_events WHERE ctid IN (
          SELECT ctid FROM audit_events WHERE created_at <= $1 LIMIT $2
        )`,
        [auditCutoff, config.RETENTION_BATCH_SIZE],
      ),
      processingJobs: await count(
        `DELETE FROM processing_jobs
         WHERE ctid IN (
           SELECT ctid FROM processing_jobs
           WHERE updated_at <= $1
             AND status IN ('failed', 'cancelled')
           LIMIT $2
         )`,
        [jobCutoff, config.RETENTION_BATCH_SIZE],
      ),
      exportJobs: await count(
        `DELETE FROM export_jobs
         WHERE ctid IN (
           SELECT ctid FROM export_jobs
           WHERE updated_at <= $1
             AND (
               status IN ('failed', 'cancelled')
               OR (status = 'ready' AND artifact_purged_at IS NOT NULL)
             )
           LIMIT $2
         )`,
        [jobCutoff, config.RETENTION_BATCH_SIZE],
      ),
      uploadSessions: await count(
        `DELETE FROM upload_sessions
         WHERE ctid IN (
           SELECT ctid FROM upload_sessions
           WHERE updated_at <= $1
             AND status IN ('failed', 'cancelled')
             AND object_purged_at IS NOT NULL
           LIMIT $2
         )`,
        [jobCutoff, config.RETENTION_BATCH_SIZE],
      ),
      sourceVersions: await count(
        `DELETE FROM source_versions AS source
         WHERE source.ctid IN (
           SELECT candidate.ctid
           FROM source_versions AS candidate
           WHERE candidate.updated_at <= $1
             AND candidate.status IN ('failed', 'cancelled')
             AND NOT EXISTS (
               SELECT 1 FROM projects AS project
               WHERE project.current_source_version_id = candidate.id
             )
             AND NOT EXISTS (
               SELECT 1 FROM upload_sessions AS upload
               WHERE upload.source_version_id = candidate.id
             )
             AND NOT EXISTS (
               SELECT 1 FROM processing_jobs AS job
               WHERE job.project_id = candidate.project_id
                 AND job.source_version_id = candidate.id
             )
             AND NOT EXISTS (
               SELECT 1 FROM export_jobs AS job
               WHERE job.project_id = candidate.project_id
                 AND job.source_version_id = candidate.id
             )
             AND NOT EXISTS (
               SELECT 1 FROM layer_documents AS document
               WHERE document.project_id = candidate.project_id
                 AND document.source_version_id = candidate.id
             )
             AND NOT EXISTS (
               SELECT 1 FROM source_version_restore_events AS restore
               WHERE restore.from_source_version_id = candidate.id
                 OR restore.to_source_version_id = candidate.id
             )
           LIMIT $2
         )`,
        [jobCutoff, config.RETENTION_BATCH_SIZE],
      ),
      uploadIntegrityEvents: await count(
        `DELETE FROM upload_integrity_events WHERE ctid IN (
          SELECT ctid FROM upload_integrity_events
          WHERE created_at <= $1 LIMIT $2
        )`,
        [auditCutoff, config.RETENTION_BATCH_SIZE],
      ),
      characterJobs: await count(
        `DELETE FROM character_jobs WHERE ctid IN (
          SELECT ctid FROM character_jobs
          WHERE updated_at <= $1
            AND status IN ('succeeded', 'failed', 'cancelled')
          LIMIT $2
        )`,
        [jobCutoff, config.RETENTION_BATCH_SIZE],
      ),
    };
    await client.query("COMMIT");
    return counts;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function daysBefore(now: string, days: number): string {
  return new Date(Date.parse(now) - days * 24 * 60 * 60_000).toISOString();
}
