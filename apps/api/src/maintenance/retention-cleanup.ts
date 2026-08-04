import type { Pool } from "pg";
import type { ObjectStorage } from "../storage/object-storage.js";
import type { RetentionConfig } from "./retention-config.js";
import type {
  AccountDeletionProcessor,
  AccountPrivacyRepository,
} from "../privacy/account-privacy.js";

export interface ExpiredUploadObject {
  uploadId: string;
  objectKey: string;
}

export interface ExpiredExportArtifact {
  exportId: string;
  objectKey: string;
}

export interface RetentionDatabaseCounts {
  sessions: number;
  mfaEnrollments: number;
  mfaChallenges: number;
  passwordResetTokens: number;
  emailOutbox: number;
  idempotencyKeys: number;
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
}

export interface RetentionStore {
  listExpiredUploads(
    now: string,
    limit: number,
  ): Promise<ExpiredUploadObject[]>;
  markUploadPurged(uploadId: string, now: string): Promise<boolean>;
  listExpiredArtifacts(
    now: string,
    limit: number,
  ): Promise<ExpiredExportArtifact[]>;
  markArtifactPurged(exportId: string, now: string): Promise<boolean>;
  pruneDatabase(
    now: string,
    config: RetentionConfig,
  ): Promise<RetentionDatabaseCounts>;
}

export interface RetentionCleanupReport {
  checkedAt: string;
  uploadsPurged: number;
  artifactsPurged: number;
  database: RetentionDatabaseCounts;
  failures: Array<{ key: string; message: string }>;
}

export class RetentionCleanup {
  constructor(
    private readonly store: RetentionStore,
    private readonly storage: ObjectStorage,
    private readonly config: RetentionConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly accountDeletions?: {
      repository: AccountPrivacyRepository;
      processor: AccountDeletionProcessor;
    },
  ) {}

  async run(): Promise<RetentionCleanupReport> {
    const checkedAt = this.now().toISOString();
    const failures: RetentionCleanupReport["failures"] = [];
    await this.resumeAccountDeletions(failures);
    const uploadsPurged = await this.purgeUploads(checkedAt, failures);
    const artifactsPurged = await this.purgeArtifacts(checkedAt, failures);
    const database = await this.store.pruneDatabase(
      checkedAt,
      this.config,
    );
    return {
      checkedAt,
      uploadsPurged,
      artifactsPurged,
      database,
      failures,
    };
  }

  private async resumeAccountDeletions(
    failures: RetentionCleanupReport["failures"],
  ): Promise<void> {
    if (!this.accountDeletions) return;
    const requests = await this.accountDeletions.repository.listPendingDeletions(
      this.config.RETENTION_BATCH_SIZE,
    );
    for (const request of requests) {
      try {
        const status = await this.accountDeletions.processor.process(request);
        if (status === "failed") {
          failures.push({
            key: `account-deletion:${request.id}`,
            message: "One or more private objects could not be deleted.",
          });
        }
      } catch (error) {
        failures.push({
          key: `account-deletion:${request.id}`,
          message: errorMessage(error),
        });
      }
    }
  }

  private async purgeUploads(
    now: string,
    failures: RetentionCleanupReport["failures"],
  ): Promise<number> {
    const uploads = await this.store.listExpiredUploads(
      now,
      this.config.RETENTION_BATCH_SIZE,
    );
    let purged = 0;
    for (const upload of uploads) {
      try {
        await this.storage.delete(upload.objectKey);
        if (await this.store.markUploadPurged(upload.uploadId, now)) purged += 1;
      } catch (error) {
        failures.push({
          key: upload.objectKey,
          message: errorMessage(error),
        });
      }
    }
    return purged;
  }

  private async purgeArtifacts(
    now: string,
    failures: RetentionCleanupReport["failures"],
  ): Promise<number> {
    const artifacts = await this.store.listExpiredArtifacts(
      now,
      this.config.RETENTION_BATCH_SIZE,
    );
    let purged = 0;
    for (const artifact of artifacts) {
      try {
        await this.storage.delete(artifact.objectKey);
        if (await this.store.markArtifactPurged(artifact.exportId, now)) {
          purged += 1;
        }
      } catch (error) {
        failures.push({
          key: artifact.objectKey,
          message: errorMessage(error),
        });
      }
    }
    return purged;
  }
}

interface UploadCleanupRow {
  upload_id: string;
  object_key: string;
}

interface ArtifactCleanupRow {
  id: string;
  project_id: string;
  filename: string;
  object_key: string | null;
}

export class PostgresRetentionStore implements RetentionStore {
  constructor(private readonly pool: Pool) {}

  async listExpiredUploads(
    now: string,
    limit: number,
  ): Promise<ExpiredUploadObject[]> {
    const result = await this.pool.query<UploadCleanupRow>(
      `
        SELECT upload_id, object_key
        FROM upload_sessions
        WHERE expires_at <= $1
          AND status <> 'ready'
          AND object_purged_at IS NULL
        ORDER BY expires_at, upload_id
        LIMIT $2
      `,
      [now, limit],
    );
    return result.rows.map((row) => ({
      uploadId: row.upload_id,
      objectKey: row.object_key,
    }));
  }

  async markUploadPurged(uploadId: string, now: string): Promise<boolean> {
    const result = await this.pool.query<{ changed: number }>(
      `
        WITH purged AS (
          UPDATE upload_sessions
          SET
            status = CASE
              WHEN status IN ('validating', 'uploading', 'verifying')
                THEN 'cancelled'
              ELSE status
            END,
            object_purged_at = $2,
            updated_at = $2
          WHERE upload_id = $1
            AND status <> 'ready'
            AND object_purged_at IS NULL
          RETURNING source_version_id
        ),
        updated_source AS (
          UPDATE source_versions AS source
          SET
            status = CASE
              WHEN source.status IN ('validating', 'uploading', 'verifying')
                THEN 'cancelled'
              ELSE source.status
            END,
            updated_at = $2
          FROM purged
          WHERE source.id = purged.source_version_id
          RETURNING source.id
        )
        SELECT count(*)::integer AS changed FROM purged
      `,
      [uploadId, now],
    );
    return result.rows[0]?.changed === 1;
  }

  async listExpiredArtifacts(
    now: string,
    limit: number,
  ): Promise<ExpiredExportArtifact[]> {
    const result = await this.pool.query<ArtifactCleanupRow>(
      `
        SELECT id, project_id, artifact->>'filename' AS filename,
          artifact->>'objectKey' AS object_key
        FROM export_jobs
        WHERE status = 'ready'
          AND artifact IS NOT NULL
          AND artifact_purged_at IS NULL
          AND artifact->>'expiresAt' <= $1
        ORDER BY artifact->>'expiresAt', id
        LIMIT $2
      `,
      [now, limit],
    );
    return result.rows.map((row) => ({
      exportId: row.id,
      objectKey:
        row.object_key ?? exportArtifactKey(row.project_id, row.id, row.filename),
    }));
  }

  async markArtifactPurged(exportId: string, now: string): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE export_jobs
        SET artifact_purged_at = $2
        WHERE id = $1
          AND status = 'ready'
          AND artifact_purged_at IS NULL
      `,
      [exportId, now],
    );
    return result.rowCount === 1;
  }

  async pruneDatabase(
    now: string,
    config: RetentionConfig,
  ): Promise<RetentionDatabaseCounts> {
    const jobCutoff = daysBefore(now, config.JOB_RETENTION_DAYS);
    const auditCutoff = daysBefore(now, config.AUDIT_RETENTION_DAYS);
    const usageCutoff = daysBefore(
      now,
      config.USAGE_LEDGER_RETENTION_DAYS,
    );
    const heartbeatCutoff = daysBefore(
      now,
      config.WORKER_HEARTBEAT_RETENTION_DAYS,
    );
    const workerEventCutoff = daysBefore(
      now,
      config.WORKER_EVENT_RETENTION_DAYS,
    );
    const client = await this.pool.connect();
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
      checkoutSessionsCancelled: await count(
        `
          UPDATE checkout_sessions
          SET status = 'cancelled'
          WHERE ctid IN (
            SELECT ctid FROM checkout_sessions
            WHERE expires_at <= $1
              AND status IN ('pending', 'redirect_required')
            LIMIT $2
          )
        `,
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
        `
          DELETE FROM processing_jobs
          WHERE ctid IN (
            SELECT ctid FROM processing_jobs
            WHERE updated_at <= $1
              AND status IN ('failed', 'cancelled')
            LIMIT $2
          )
        `,
        [jobCutoff, config.RETENTION_BATCH_SIZE],
      ),
      exportJobs: await count(
        `
          DELETE FROM export_jobs
          WHERE ctid IN (
            SELECT ctid FROM export_jobs
            WHERE updated_at <= $1
              AND (
                status IN ('failed', 'cancelled')
                OR (status = 'ready' AND artifact_purged_at IS NOT NULL)
              )
            LIMIT $2
          )
        `,
        [jobCutoff, config.RETENTION_BATCH_SIZE],
      ),
      uploadSessions: await count(
        `
          DELETE FROM upload_sessions
          WHERE ctid IN (
            SELECT ctid FROM upload_sessions
            WHERE updated_at <= $1
              AND status IN ('failed', 'cancelled')
              AND object_purged_at IS NOT NULL
            LIMIT $2
          )
        `,
        [jobCutoff, config.RETENTION_BATCH_SIZE],
      ),
      sourceVersions: await count(
        `
          DELETE FROM source_versions AS source
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
          )
        `,
        [jobCutoff, config.RETENTION_BATCH_SIZE],
      ),
      uploadIntegrityEvents: await count(
        `DELETE FROM upload_integrity_events WHERE ctid IN (
          SELECT ctid FROM upload_integrity_events
          WHERE created_at <= $1 LIMIT $2
        )`,
        [auditCutoff, config.RETENTION_BATCH_SIZE],
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
}

export function exportArtifactKey(
  projectId: string,
  exportId: string,
  filename: string,
): string {
  return `artifacts/${projectId}/${exportId}/${filename}`;
}

function daysBefore(now: string, days: number): string {
  return new Date(Date.parse(now) - days * 24 * 60 * 60_000).toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
