import type { Pool } from "pg";
import type { ObjectStorage } from "../storage/object-storage.js";
import type { RetentionConfig } from "./retention-config.js";
import type {
  AccountDeletionProcessor,
  AccountPrivacyRepository,
} from "../privacy/account-privacy.js";
import {
  pruneRetentionDatabase,
  type RetentionDatabaseCounts,
} from "./prune-retention-database.js";

export type { RetentionDatabaseCounts } from "./prune-retention-database.js";

export interface ExpiredUploadObject {
  uploadId: string;
  objectKey: string;
}

export interface ExpiredExportArtifact {
  exportId: string;
  objectKey: string;
}

export interface ExpiredCharacterReference {
  referenceId: string;
  objectKey: string;
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
  listExpiredCharacterReferences(
    now: string,
    limit: number,
  ): Promise<ExpiredCharacterReference[]>;
  markCharacterReferencePurged(
    referenceId: string,
    now: string,
  ): Promise<boolean>;
  pruneDatabase(
    now: string,
    config: RetentionConfig,
  ): Promise<RetentionDatabaseCounts>;
}

export interface RetentionCleanupReport {
  checkedAt: string;
  uploadsPurged: number;
  artifactsPurged: number;
  characterReferencesPurged: number;
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
    const characterReferencesPurged = await this.purgeCharacterReferences(
      checkedAt,
      failures,
    );
    const database = await this.store.pruneDatabase(
      checkedAt,
      this.config,
    );
    return {
      checkedAt,
      uploadsPurged,
      artifactsPurged,
      characterReferencesPurged,
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

  private async purgeCharacterReferences(
    now: string,
    failures: RetentionCleanupReport["failures"],
  ): Promise<number> {
    const references = await this.store.listExpiredCharacterReferences(
      now,
      this.config.RETENTION_BATCH_SIZE,
    );
    let purged = 0;
    for (const reference of references) {
      try {
        await this.storage.delete(reference.objectKey);
        if (
          await this.store.markCharacterReferencePurged(
            reference.referenceId,
            now,
          )
        ) {
          purged += 1;
        }
      } catch (error) {
        failures.push({
          key: reference.objectKey,
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

interface CharacterReferenceCleanupRow {
  id: string;
  object_key: string;
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

  async listExpiredCharacterReferences(
    now: string,
    limit: number,
  ): Promise<ExpiredCharacterReference[]> {
    const result = await this.pool.query<CharacterReferenceCleanupRow>(
      `SELECT reference.id, reference.artifact->>'objectKey' AS object_key
       FROM character_reference_assets reference
       WHERE reference.retention_expires_at <= $1
         AND reference.artifact ? 'objectKey'
         AND NOT EXISTS (
           SELECT 1 FROM character_identity_model_versions model
           WHERE model.bible_id = reference.bible_id
             AND model.status IN ('draft', 'training')
         )
       ORDER BY reference.retention_expires_at, reference.id
       LIMIT $2`,
      [now, limit],
    );
    return result.rows.map((row) => ({
      referenceId: row.id,
      objectKey: row.object_key,
    }));
  }

  async markCharacterReferencePurged(
    referenceId: string,
    now: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM character_reference_assets
       WHERE id = $1 AND retention_expires_at <= $2
         AND NOT EXISTS (
           SELECT 1 FROM character_identity_model_versions model
           WHERE model.bible_id = character_reference_assets.bible_id
             AND model.status IN ('draft', 'training')
         )`,
      [referenceId, now],
    );
    return result.rowCount === 1;
  }

  async pruneDatabase(
    now: string,
    config: RetentionConfig,
  ): Promise<RetentionDatabaseCounts> {
    return pruneRetentionDatabase(this.pool, now, config);
  }
}

export function exportArtifactKey(
  projectId: string,
  exportId: string,
  filename: string,
): string {
  return `artifacts/${projectId}/${exportId}/${filename}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
