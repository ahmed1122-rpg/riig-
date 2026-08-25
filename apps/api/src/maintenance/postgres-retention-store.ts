import type { Pool } from "pg";
import type {
  ExpiredCharacterReference,
  ExpiredExportArtifact,
  ExpiredMalwareQuarantine,
  ExpiredUploadObject,
  RetentionStore,
  UnreferencedDerivedAsset,
} from "./retention-contract.js";
import { rollbackTransaction } from "../infrastructure/postgres/database.js";
import { pruneRetentionDatabase } from "./prune-retention-database.js";
import { exportArtifactKey } from "./retention-contract.js";

interface UploadRow { upload_id: string; object_key: string }
interface ArtifactRow {
  id: string; project_id: string; filename: string; object_key: string | null;
}
interface ReferenceRow { id: string; object_key: string }
interface DerivedRow { object_key: string; updated_at: Date | string }
interface MalwareQuarantineRow {
  id: string;
  quarantine_object_key: string;
  delete_object: boolean;
}

export class PostgresRetentionStore implements RetentionStore {
  constructor(private readonly pool: Pool) {}

  async listExpiredMalwareQuarantines(
    now: string,
    limit: number,
  ): Promise<ExpiredMalwareQuarantine[]> {
    const result = await this.pool.query<MalwareQuarantineRow>(
      `SELECT scan.id, scan.quarantine_object_key,
         CASE
           WHEN scan.status = 'malicious' THEN true
           WHEN scan.quarantine_object_key = scan.object_key
             AND (
               scan.status = 'clean'
               OR (scan.status = 'failed' AND upload.malware_scan_backfill = true)
             ) THEN false
           ELSE true
         END AS delete_object
       FROM malware_scan_jobs AS scan
       JOIN upload_sessions AS upload ON upload.upload_id = scan.upload_id
       WHERE scan.status IN ('clean', 'malicious', 'failed')
         AND scan.quarantine_object_purged_at IS NULL
         AND (scan.quarantine_purge_claimed_at IS NULL
           OR scan.quarantine_purge_claimed_at <= $1::timestamptz - interval '1 hour')
       ORDER BY scan.completed_at NULLS LAST, scan.id
       LIMIT $2`,
      [now, limit],
    );
    return result.rows.map((row) => ({
      scanJobId: row.id,
      objectKey: row.quarantine_object_key,
      deleteObject: row.delete_object,
    }));
  }

  async claimMalwareQuarantinePurge(
    quarantine: ExpiredMalwareQuarantine,
    now: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE malware_scan_jobs
       SET quarantine_purge_claimed_at = $3, updated_at = $3
       WHERE id = $1 AND quarantine_object_key = $2
         AND status IN ('clean', 'malicious', 'failed')
         AND quarantine_object_purged_at IS NULL
         AND (quarantine_purge_claimed_at IS NULL
           OR quarantine_purge_claimed_at <= $3::timestamptz - interval '1 hour')`,
      [quarantine.scanJobId, quarantine.objectKey, now],
    );
    return result.rowCount === 1;
  }

  async markMalwareQuarantinePurged(
    scanJobId: string,
    now: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE malware_scan_jobs
       SET quarantine_object_purged_at = $2,
           quarantine_purge_claimed_at = NULL,
           updated_at = $2
       WHERE id = $1 AND quarantine_purge_claimed_at = $2
         AND quarantine_object_purged_at IS NULL`,
      [scanJobId, now],
    );
    return result.rowCount === 1;
  }

  async listExpiredUploads(now: string, limit: number): Promise<ExpiredUploadObject[]> {
    const result = await this.pool.query<UploadRow>(
      `SELECT upload_id, object_key FROM upload_sessions
       WHERE expires_at <= $1 AND ${uploadObjectMayBePurged("upload_sessions")}
         AND object_purged_at IS NULL
       ORDER BY expires_at, upload_id LIMIT $2`,
      [now, limit],
    );
    return result.rows.map((row) => ({ uploadId: row.upload_id, objectKey: row.object_key }));
  }

  async claimUploadPurge(upload: ExpiredUploadObject, now: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE upload_sessions AS upload
       SET purge_claimed_at = $3, updated_at = $3
       WHERE upload.upload_id = $1 AND upload.object_key = $2
         AND ${uploadObjectMayBePurged("upload")}
         AND upload.object_purged_at IS NULL
         AND (upload.purge_claimed_at IS NULL
           OR upload.purge_claimed_at <= $3::timestamptz - interval '1 hour')`,
      [upload.uploadId, upload.objectKey, now],
    );
    return result.rowCount === 1;
  }

  async markUploadPurged(uploadId: string, now: string): Promise<boolean> {
    const result = await this.pool.query<{ changed: number }>(
       `WITH purged AS (
         UPDATE upload_sessions AS upload SET status = CASE
             WHEN upload.status IN ('validating', 'uploading', 'verifying', 'scanning')
               THEN 'cancelled' ELSE status END,
           object_purged_at = $2, updated_at = $2
         WHERE upload.upload_id = $1
           AND ${uploadObjectMayBePurged("upload")}
           AND upload.object_purged_at IS NULL
           AND upload.purge_claimed_at = $2
         RETURNING upload.source_version_id
       ), updated_source AS (
         UPDATE source_versions source SET status = CASE
             WHEN source.status IN ('validating', 'uploading', 'verifying', 'scanning')
               THEN 'cancelled' ELSE source.status END, updated_at = $2
         FROM purged WHERE source.id = purged.source_version_id RETURNING source.id
       ) SELECT count(*)::integer AS changed FROM purged`,
      [uploadId, now],
    );
    return result.rows[0]?.changed === 1;
  }

  async listExpiredArtifacts(now: string, limit: number): Promise<ExpiredExportArtifact[]> {
    const result = await this.pool.query<ArtifactRow>(
      `SELECT id, project_id, artifact->>'filename' AS filename,
         artifact->>'objectKey' AS object_key FROM export_jobs
       WHERE status = 'ready' AND artifact IS NOT NULL
         AND artifact_purged_at IS NULL
         AND (artifact->>'expiresAt')::timestamptz <= $1::timestamptz
       ORDER BY (artifact->>'expiresAt')::timestamptz, id LIMIT $2`,
      [now, limit],
    );
    return result.rows.map((row) => ({
      exportId: row.id,
      objectKey: row.object_key ?? exportArtifactKey(row.project_id, row.id, row.filename),
    }));
  }

  async claimArtifactPurge(artifact: ExpiredExportArtifact, now: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE export_jobs
       SET purge_claimed_at = $3::timestamptz,
           updated_at = $3::timestamptz
       WHERE id = $1 AND COALESCE(
           artifact->>'objectKey',
           'artifacts/' || project_id::text || '/' || id::text || '/' || (artifact->>'filename')
         ) = $2
         AND status = 'ready' AND artifact_purged_at IS NULL
         AND (artifact->>'expiresAt')::timestamptz <= $3::timestamptz
         AND (purge_claimed_at IS NULL
           OR purge_claimed_at <= $3::timestamptz - interval '1 hour')`,
      [artifact.exportId, artifact.objectKey, now],
    );
    return result.rowCount === 1;
  }

  async markArtifactPurged(exportId: string, now: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE export_jobs SET artifact_purged_at = $2 WHERE id = $1
       AND status = 'ready' AND artifact_purged_at IS NULL
       AND purge_claimed_at = $2`,
      [exportId, now],
    );
    return result.rowCount === 1;
  }

  async listExpiredCharacterReferences(
    now: string,
    limit: number,
  ): Promise<ExpiredCharacterReference[]> {
    const result = await this.pool.query<ReferenceRow>(
      `SELECT reference.id, reference.artifact->>'objectKey' AS object_key
       FROM character_reference_assets reference
       WHERE reference.retention_expires_at <= $1 AND reference.artifact ? 'objectKey'
         AND NOT EXISTS (SELECT 1 FROM character_identity_model_versions model
           WHERE model.bible_id = reference.bible_id
             AND model.status IN ('draft', 'training', 'ready'))
       ORDER BY reference.retention_expires_at, reference.id LIMIT $2`,
      [now, limit],
    );
    return result.rows.map((row) => ({ referenceId: row.id, objectKey: row.object_key }));
  }

  async claimCharacterReferencePurge(
    reference: ExpiredCharacterReference,
    now: string,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        `SELECT reference.id FROM character_reference_assets reference
         WHERE reference.id = $1 AND reference.artifact->>'objectKey' = $2
           AND reference.retention_expires_at <= $3
         FOR UPDATE`,
        [reference.referenceId, reference.objectKey, now],
      );
      if (!locked.rowCount) {
        await client.query("ROLLBACK");
        return false;
      }
      const result = await client.query(
        `UPDATE character_reference_assets reference SET purge_claimed_at = $3
         WHERE reference.id = $1 AND reference.artifact->>'objectKey' = $2
           AND reference.retention_expires_at <= $3
           AND (reference.purge_claimed_at IS NULL
             OR reference.purge_claimed_at <= $3::timestamptz - interval '1 hour')
           AND NOT EXISTS (SELECT 1 FROM character_identity_model_versions model
             WHERE model.bible_id = reference.bible_id
               AND model.status IN ('draft', 'training', 'ready'))`,
        [reference.referenceId, reference.objectKey, now],
      );
      await client.query("COMMIT");
      return result.rowCount === 1;
    } catch (error) {
      await rollbackTransaction(client, error);
      throw error;
    } finally {
      client.release();
    }
  }

  async markCharacterReferencePurged(referenceId: string, now: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM character_reference_assets WHERE id = $1
       AND retention_expires_at <= $2 AND purge_claimed_at = $2
       AND NOT EXISTS (SELECT 1 FROM character_identity_model_versions model
         WHERE model.bible_id = character_reference_assets.bible_id
           AND model.status IN ('draft', 'training', 'ready'))`,
      [referenceId, now],
    );
    return result.rowCount === 1;
  }

  async listUnreferencedDerivedAssets(
    now: string,
    limit: number,
  ): Promise<UnreferencedDerivedAsset[]> {
    const result = await this.pool.query<DerivedRow>(
      `SELECT registry.object_key, registry.updated_at FROM derived_asset_registry registry
       WHERE registry.purged_at IS NULL
         AND registry.updated_at <= $1::timestamptz - interval '1 hour'
         AND ${derivedAssetIsUnreferenced("registry")}
       ORDER BY registry.updated_at, registry.object_key LIMIT $2`,
      [now, limit],
    );
    return result.rows.map((row) => ({
      objectKey: row.object_key,
      observedUpdatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  async claimDerivedAssetPurge(asset: UnreferencedDerivedAsset, now: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        `SELECT registry.object_key FROM derived_asset_registry registry
         WHERE registry.object_key = $1 AND registry.updated_at = $2
           AND registry.purged_at IS NULL
         FOR UPDATE`,
        [asset.objectKey, asset.observedUpdatedAt],
      );
      if (!locked.rowCount) {
        await client.query("ROLLBACK");
        return false;
      }
      const result = await client.query(
        `UPDATE derived_asset_registry registry
         SET purge_claimed_at = $3, updated_at = $3
         WHERE registry.object_key = $1 AND registry.updated_at = $2
           AND registry.purged_at IS NULL
           AND ${derivedAssetIsUnreferenced("registry")}`,
        [asset.objectKey, asset.observedUpdatedAt, now],
      );
      await client.query("COMMIT");
      return result.rowCount === 1;
    } catch (error) {
      await rollbackTransaction(client, error);
      throw error;
    } finally {
      client.release();
    }
  }

  async markDerivedAssetPurged(
    objectKey: string,
    _observedUpdatedAt: string,
    now: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE derived_asset_registry registry SET purged_at = $2, updated_at = $2
       WHERE registry.object_key = $1 AND registry.purge_claimed_at = $2
         AND registry.purged_at IS NULL`,
      [objectKey, now],
    );
    return result.rowCount === 1;
  }

  pruneDatabase(now: string, config: Parameters<RetentionStore["pruneDatabase"]>[1]) {
    return pruneRetentionDatabase(this.pool, now, config);
  }
}

function uploadObjectMayBePurged(alias: string): string {
  return `${alias}.status <> 'ready'
    AND NOT (
      ${alias}.malware_scan_backfill = true
      AND (
        (${alias}.status = 'scanning'
          AND ${alias}.malware_scan_verdict = 'pending')
        OR (${alias}.status = 'scan_failed'
          AND ${alias}.malware_scan_verdict = 'error')
      )
    )`;
}

function derivedAssetIsUnreferenced(alias: string): string {
  return `NOT EXISTS (SELECT 1 FROM layer_documents document,
      LATERAL jsonb_path_query(document.document, '$.**.objectKey') value
    WHERE value #>> '{}' = ${alias}.object_key)
    AND NOT EXISTS (SELECT 1 FROM layer_document_revisions revision,
      LATERAL jsonb_path_query(revision.document, '$.**.objectKey') value
    WHERE value #>> '{}' = ${alias}.object_key)`;
}
