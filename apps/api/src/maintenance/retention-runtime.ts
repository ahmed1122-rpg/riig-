import type { Pool, PoolClient } from "pg";
import {
  createDatabase,
  type DatabaseHandle,
} from "../infrastructure/postgres/database.js";
import {
  createS3ObjectStorageOptions,
  createWorkerEnvironmentSchema,
} from "../storage/object-storage-environment.js";
import { S3ObjectStorage } from "../storage/s3-object-storage.js";
import {
  loadRetentionConfig,
  type RetentionConfig,
} from "./retention-config.js";
import {
  RetentionCleanup,
  type RetentionCleanupReport,
} from "./retention-cleanup.js";
import { PostgresRetentionStore } from "./postgres-retention-store.js";
import { PostgresAccountPrivacyRepository } from "../infrastructure/postgres/postgres-account-privacy-repository.js";
import { AccountDeletionProcessor } from "../privacy/account-privacy.js";

const RETENTION_ADVISORY_LOCK_ID = 1_971_041_106;
const retentionRuntimeEnvironmentSchema = createWorkerEnvironmentSchema({});

export function loadRetentionRuntimeEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return retentionRuntimeEnvironmentSchema.parse(environment);
}

export class PostgresRetentionRunner {
  constructor(
    private readonly pool: Pool,
    private readonly cleanup: RetentionCleanup,
    private readonly intervalMilliseconds = 60 * 60_000,
  ) {}

  async run(): Promise<RetentionCleanupReport | null> {
    const lockClient = await this.pool.connect();
    let acquired = false;
    try {
      acquired = await acquireLock(lockClient);
      if (!acquired) return null;
      const startedAt = new Date();
      await this.recordStarted(startedAt);
      try {
        const report = await this.cleanup.run();
        if (report.failures.length > 0) {
          await this.recordFailure(
            new Date(),
            report.failures.map((failure) => failure.message).join("; "),
          );
        } else {
          await this.recordSuccess(new Date());
        }
        return report;
      } catch (error) {
        try {
          await this.recordFailure(
            new Date(),
            error instanceof Error ? error.message : String(error),
          );
        } catch (recordingError) {
          throw new AggregateError(
            [error, recordingError],
            "Retention cleanup failed and its failure status could not be persisted.",
            { cause: recordingError },
          );
        }
        throw error;
      }
    } finally {
      if (acquired) {
        await lockClient.query("SELECT pg_advisory_unlock($1)", [
          RETENTION_ADVISORY_LOCK_ID,
        ]);
      }
      lockClient.release();
    }
  }

  private async recordStarted(startedAt: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO maintenance_status (task, last_started_at)
       VALUES ('retention', $1)
       ON CONFLICT (task) DO UPDATE SET last_started_at = EXCLUDED.last_started_at`,
      [startedAt.toISOString()],
    );
  }

  private async recordSuccess(completedAt: Date): Promise<void> {
    const staleAfter = new Date(
      completedAt.getTime() + Math.max(30 * 60_000, this.intervalMilliseconds * 2),
    );
    await this.pool.query(
      `UPDATE maintenance_status
       SET last_succeeded_at = $2,
           last_error = NULL,
           stale_after_at = $3
       WHERE task = $1`,
      ["retention", completedAt.toISOString(), staleAfter.toISOString()],
    );
  }

  private async recordFailure(failedAt: Date, message: string): Promise<void> {
    await this.pool.query(
      `UPDATE maintenance_status
       SET last_failed_at = $2, last_error = left($3, 1000)
       WHERE task = $1`,
      ["retention", failedAt.toISOString(), message],
    );
  }
}

export interface RetentionRuntime {
  config: RetentionConfig;
  runner: PostgresRetentionRunner;
  ready(): Promise<void>;
  close(): Promise<void>;
}

export function createRetentionRuntime(): RetentionRuntime {
  const config = loadRetentionRuntimeEnvironment();

  const database: DatabaseHandle = createDatabase(
    config.DATABASE_URL,
    Math.max(2, Math.min(config.DATABASE_POOL_MAX, 3)),
  );
  const storage = new S3ObjectStorage(createS3ObjectStorageOptions(config));
  const retentionConfig = loadRetentionConfig();
  const accountPrivacy = new PostgresAccountPrivacyRepository(database.pool);
  const cleanup = new RetentionCleanup(
    new PostgresRetentionStore(database.pool),
    storage,
    retentionConfig,
    () => new Date(),
    {
      repository: accountPrivacy,
      processor: new AccountDeletionProcessor(accountPrivacy, storage),
    },
  );

  return {
    config: retentionConfig,
    runner: new PostgresRetentionRunner(
      database.pool,
      cleanup,
      retentionConfig.RETENTION_RUN_INTERVAL_MINUTES * 60_000,
    ),
    async ready() {
      await Promise.all([database.ready(), storage.ready(false)]);
    },
    async close() {
      storage.destroy();
      await database.close();
    },
  };
}

async function acquireLock(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock($1) AS acquired",
    [RETENTION_ADVISORY_LOCK_ID],
  );
  return result.rows[0]?.acquired === true;
}
