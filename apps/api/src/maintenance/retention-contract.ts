import type { RetentionConfig } from "./retention-config.js";
import type { RetentionDatabaseCounts } from "./prune-retention-database.js";

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

export interface UnreferencedDerivedAsset {
  objectKey: string;
  observedUpdatedAt: string;
}

export interface RetentionStore {
  listExpiredUploads(now: string, limit: number): Promise<ExpiredUploadObject[]>;
  claimUploadPurge(upload: ExpiredUploadObject, now: string): Promise<boolean>;
  markUploadPurged(uploadId: string, now: string): Promise<boolean>;
  listExpiredArtifacts(now: string, limit: number): Promise<ExpiredExportArtifact[]>;
  claimArtifactPurge(artifact: ExpiredExportArtifact, now: string): Promise<boolean>;
  markArtifactPurged(exportId: string, now: string): Promise<boolean>;
  listExpiredCharacterReferences(
    now: string,
    limit: number,
  ): Promise<ExpiredCharacterReference[]>;
  claimCharacterReferencePurge(
    reference: ExpiredCharacterReference,
    now: string,
  ): Promise<boolean>;
  markCharacterReferencePurged(referenceId: string, now: string): Promise<boolean>;
  listUnreferencedDerivedAssets(
    now: string,
    limit: number,
  ): Promise<UnreferencedDerivedAsset[]>;
  claimDerivedAssetPurge(asset: UnreferencedDerivedAsset, now: string): Promise<boolean>;
  markDerivedAssetPurged(
    objectKey: string,
    observedUpdatedAt: string,
    now: string,
  ): Promise<boolean>;
  pruneDatabase(now: string, config: RetentionConfig): Promise<RetentionDatabaseCounts>;
}

export interface RetentionCleanupReport {
  checkedAt: string;
  uploadsPurged: number;
  artifactsPurged: number;
  characterReferencesPurged: number;
  derivedAssetsPurged: number;
  database: RetentionDatabaseCounts;
  failures: Array<{ key: string; message: string }>;
}

export function exportArtifactKey(
  projectId: string,
  exportId: string,
  filename: string,
): string {
  return `artifacts/${projectId}/${exportId}/${filename}`;
}
