import { loadConfig } from "../config.js";
import { createDatabase } from "../infrastructure/postgres/database.js";
import { createS3ObjectStorageOptions } from "../storage/object-storage-environment.js";
import { S3ObjectStorage } from "../storage/s3-object-storage.js";
import { loadRetentionConfig } from "./retention-config.js";
import {
  PostgresRetentionStore,
  RetentionCleanup,
} from "./retention-cleanup.js";

const config = loadConfig();
if (config.PERSISTENCE_MODE !== "postgres" || !config.DATABASE_URL) {
  throw new Error("Retention cleanup requires PostgreSQL persistence.");
}
if (config.OBJECT_STORAGE_MODE !== "s3") {
  throw new Error("Retention cleanup requires durable S3 object storage.");
}

const database = createDatabase(
  config.DATABASE_URL,
  Math.min(config.DATABASE_POOL_MAX, 3),
);
const storage = new S3ObjectStorage(createS3ObjectStorageOptions(config));

try {
  await Promise.all([database.ready(), storage.ready(false)]);
  const cleanup = new RetentionCleanup(
    new PostgresRetentionStore(database.pool),
    storage,
    loadRetentionConfig(),
  );
  const report = await cleanup.run();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.failures.length > 0) process.exitCode = 1;
} finally {
  storage.destroy();
  await database.close();
}
