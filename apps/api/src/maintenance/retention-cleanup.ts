import type { ObjectStorage } from "../storage/object-storage.js";
import type { RetentionConfig } from "./retention-config.js";
import type {
  AccountDeletionProcessor,
  AccountPrivacyRepository,
} from "../privacy/account-privacy.js";
export type { RetentionDatabaseCounts } from "./prune-retention-database.js";
import type {
  RetentionCleanupReport,
  RetentionStore,
} from "./retention-contract.js";
export type {
  RetentionCleanupReport,
  RetentionStore,
} from "./retention-contract.js";
export { exportArtifactKey } from "./retention-contract.js";

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
    const derivedAssetsPurged = await this.purgeDerivedAssets(
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
      derivedAssetsPurged,
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
        if (!await this.store.claimUploadPurge(upload, now)) continue;
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
        if (!await this.store.claimArtifactPurge(artifact, now)) continue;
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
        if (!await this.store.claimCharacterReferencePurge(reference, now)) {
          continue;
        }
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

  private async purgeDerivedAssets(
    now: string,
    failures: RetentionCleanupReport["failures"],
  ): Promise<number> {
    const assets = await this.store.listUnreferencedDerivedAssets(
      now,
      this.config.RETENTION_BATCH_SIZE,
    );
    let purged = 0;
    for (const asset of assets) {
      try {
        if (!await this.store.claimDerivedAssetPurge(asset, now)) continue;
        await this.storage.delete(asset.objectKey);
        if (
          await this.store.markDerivedAssetPurged(
            asset.objectKey,
            asset.observedUpdatedAt,
            now,
          )
        ) {
          purged += 1;
        }
      } catch (error) {
        failures.push({
          key: asset.objectKey,
          message: errorMessage(error),
        });
      }
    }
    return purged;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
