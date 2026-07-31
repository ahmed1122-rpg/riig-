import type { AppConfig } from "../../config.js";
import { createDatabase } from "./database.js";
import { PostgresAuditRepository } from "./postgres-audit-repository.js";
import { PostgresAuthRepository } from "./postgres-auth-repository.js";
import { PostgresBillingRepository } from "./postgres-billing-repository.js";
import { PostgresExportRepository } from "./postgres-export-repository.js";
import { PostgresIdempotencyStore } from "./postgres-idempotency-store.js";
import { PostgresProjectRepository } from "./postgres-project-repository.js";
import { PostgresUploadRepository } from "./postgres-upload-repository.js";
import { PostgresSourceVersionRepository } from "./postgres-source-version-repository.js";
import {
  PostgresLayerDocumentRepository,
  PostgresProcessingJobRepository,
} from "./postgres-processing-repository.js";
import { PostgresAdminAccessCommand } from "./postgres-admin-access-command.js";
import { PostgresUsageMeter } from "./postgres-usage-meter.js";
import { PostgresOperationalStatusProvider } from "./postgres-operational-status.js";
import { PostgresSourceVersionRestoreCommand } from "./postgres-source-version-restore.js";

export function createPostgresPersistence(config: AppConfig) {
  if (!config.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for PostgreSQL persistence.");
  }
  const database = createDatabase(
    config.DATABASE_URL,
    config.DATABASE_POOL_MAX,
  );

  return {
    repositories: {
      projects: new PostgresProjectRepository(database.pool),
      uploads: new PostgresUploadRepository(database.pool),
      sourceVersions: new PostgresSourceVersionRepository(database.pool),
      sourceVersionRestores: new PostgresSourceVersionRestoreCommand(
        database.pool,
      ),
      exports: new PostgresExportRepository(database.pool),
      auth: new PostgresAuthRepository(database.pool),
      audit: new PostgresAuditRepository(database.pool),
      billing: new PostgresBillingRepository(database.pool),
      idempotency: new PostgresIdempotencyStore(database.pool),
      processingJobs: new PostgresProcessingJobRepository(database.pool),
      layerDocuments: new PostgresLayerDocumentRepository(database.pool),
    },
    adminAccess: new PostgresAdminAccessCommand(database.pool),
    usageMeter: new PostgresUsageMeter(
      database.pool,
      config.USAGE_METERING_MODE,
    ),
    operationalStatus: new PostgresOperationalStatusProvider(database.pool),
    ready: () => database.ready(),
    close: () => database.close(),
  };
}
