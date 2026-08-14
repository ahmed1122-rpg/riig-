import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./database.js";
import {
  assertMigrationNames,
  migrationChecksum,
} from "./migration-integrity.js";
import {
  acquireMigrationAdvisoryLock,
  applyMigrationTimeouts,
  loadMigrationDatabaseUrl,
  loadMigrationRuntimePolicy,
  releaseMigrationAdvisoryLock,
} from "./migration-runtime-policy.js";

const database = createDatabase(loadMigrationDatabaseUrl(), 2, {
  applicationName: "motionprep-migrate",
});
const migrationPolicy = loadMigrationRuntimePolicy();
const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../migrations",
);
const client = await database.pool.connect();
let advisoryLockAcquired = false;

try {
  await database.ready();
  await acquireMigrationAdvisoryLock(
    client,
    migrationPolicy.advisoryLockTimeoutMs,
  );
  advisoryLockAcquired = true;
  await applyMigrationTimeouts(client, migrationPolicy, false);
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum_sha256 char(64),
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    ALTER TABLE schema_migrations
      ADD COLUMN IF NOT EXISTS checksum_sha256 char(64)
  `);
  // 0.1 shipped two files with the 004 prefix. Normalize that historical
  // filename before enforcing unique numeric identifiers in the repository.
  await client.query(`
    UPDATE schema_migrations AS legacy
    SET filename = '017_processing_options.sql'
    WHERE legacy.filename = '004_processing_options.sql'
      AND NOT EXISTS (
        SELECT 1
        FROM schema_migrations AS current
        WHERE current.filename = '017_processing_options.sql'
      )
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  assertMigrationNames(files);
  const migrations = await Promise.all(
    files.map(async (filename) => {
      const sql = await readFile(
        path.join(migrationsDirectory, filename),
        "utf8",
      );
      return { filename, sql, checksum: migrationChecksum(sql) };
    }),
  );
  const byFilename = new Map(
    migrations.map((migration) => [migration.filename, migration]),
  );
  const applied = await client.query<{
    filename: string;
    checksum_sha256: string | null;
  }>(
    "SELECT filename, checksum_sha256 FROM schema_migrations ORDER BY filename",
  );

  for (const row of applied.rows) {
    const migration = byFilename.get(row.filename);
    if (!migration) {
      throw new Error(
        `Applied migration ${row.filename} is missing from the repository.`,
      );
    }
    if (row.checksum_sha256 && row.checksum_sha256 !== migration.checksum) {
      throw new Error(
        `Checksum mismatch for applied migration ${row.filename}. Historical migrations are immutable.`,
      );
    }
    if (!row.checksum_sha256) {
      await client.query(
        `UPDATE schema_migrations
         SET checksum_sha256 = $2
         WHERE filename = $1 AND checksum_sha256 IS NULL`,
        [row.filename, migration.checksum],
      );
    }
  }

  for (const migration of migrations) {
    if (applied.rows.some((row) => row.filename === migration.filename)) {
      continue;
    }
    try {
      await client.query("BEGIN");
      await applyMigrationTimeouts(client, migrationPolicy, true);
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO schema_migrations (filename, checksum_sha256)
         VALUES ($1, $2)`,
        [migration.filename, migration.checksum],
      );
      await client.query("COMMIT");
      process.stdout.write(`Applied ${migration.filename}\n`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  await client.query(`
    ALTER TABLE schema_migrations
      ALTER COLUMN checksum_sha256 SET NOT NULL
  `);
} finally {
  if (advisoryLockAcquired) {
    await releaseMigrationAdvisoryLock(client, advisoryLockAcquired)
      .catch((error: unknown) => {
        process.stderr.write(
          `${JSON.stringify({
            event: "migration_advisory_unlock_failed",
            message: error instanceof Error ? error.message : String(error),
          })}\n`,
        );
      });
  }
  client.release();
  await database.close();
}
