import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertMigrationNames,
  migrationChecksum,
} from "./migration-integrity.js";

describe("migration integrity", () => {
  it("creates a stable SHA-256 checksum", () => {
    expect(migrationChecksum("SELECT 1;\n")).toMatch(/^[a-f0-9]{64}$/u);
    expect(migrationChecksum("SELECT 1;\n")).toBe(
      migrationChecksum("SELECT 1;\n"),
    );
    expect(migrationChecksum("SELECT 2;\n")).not.toBe(
      migrationChecksum("SELECT 1;\n"),
    );
  });

  it("rejects every duplicate migration identifier", () => {
    expect(() =>
      assertMigrationNames(["013_first.sql", "013_second.sql"]),
    ).toThrow(/prefix 013 is duplicated/u);
  });

  it("rejects names that cannot be ordered safely", () => {
    expect(() => assertMigrationNames(["14_bad.sql"])).toThrow(
      /NNN_description/u,
    );
  });

  it("keeps the checked-in migration sequence unique and additive", async () => {
    const directory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../migrations",
    );
    const files = (await readdir(directory)).filter((filename) =>
      filename.endsWith(".sql"),
    );
    const sourceVersionMigration = await readFile(
      path.join(directory, "009_source_versions.sql"),
      "utf8",
    );
    const compatibilityMigration = await readFile(
      path.join(directory, "019_upload_url_compatibility.sql"),
      "utf8",
    );
    const sourceRestoreMigration = await readFile(
      path.join(directory, "021_source_version_restores.sql"),
      "utf8",
    );
    const documentRevisionMigration = await readFile(
      path.join(directory, "022_layer_document_revisions.sql"),
      "utf8",
    );
    const workerResourceMigration = await readFile(
      path.join(directory, "030_worker_resource_metrics.sql"),
      "utf8",
    );
    const projectReviewMigration = await readFile(
      path.join(directory, "031_project_review_approvals.sql"),
      "utf8",
    );
    const uploadIntegrityMigration = await readFile(
      path.join(directory, "032_upload_integrity_failures.sql"),
      "utf8",
    );
    const idempotencyFingerprintMigration = await readFile(
      path.join(directory, "033_idempotency_request_fingerprints.sql"),
      "utf8",
    );
    const exportPreflightMigration = await readFile(
      path.join(directory, "034_remove_export_preflight_status.sql"),
      "utf8",
    );
    const sourceRestoreIdentityMigration = await readFile(
      path.join(directory, "035_source_version_restore_identity.sql"),
      "utf8",
    );
    const uploadCancellationMigration = await readFile(
      path.join(directory, "036_upload_cancellation_convergence.sql"),
      "utf8",
    );
    const accountPrivacyMigration = await readFile(
      path.join(directory, "037_account_privacy.sql"),
      "utf8",
    );
    const characterRigMigration = await readFile(
      path.join(directory, "038_character_rig_context.sql"),
      "utf8",
    );
    const characterWorkerObservabilityMigration = await readFile(
      path.join(directory, "039_character_worker_observability.sql"),
      "utf8",
    );
    const privacyRetentionMigration = await readFile(
      path.join(directory, "042_privacy_retention_state_machines.sql"),
      "utf8",
    );

    expect(() => assertMigrationNames(files)).not.toThrow();
    expect(sourceVersionMigration).not.toMatch(
      /RENAME\s+COLUMN|DROP\s+COLUMN/iu,
    );
    expect(sourceVersionMigration).toContain("demo_upload_url");
    expect(sourceVersionMigration).toContain("upload_url");
    expect(compatibilityMigration).not.toMatch(
      /RENAME\s+COLUMN|DROP\s+COLUMN/iu,
    );
    expect(compatibilityMigration).toContain(
      "ADD COLUMN IF NOT EXISTS demo_upload_url",
    );
    expect(compatibilityMigration).toContain(
      "ADD COLUMN IF NOT EXISTS upload_url",
    );
    expect(sourceRestoreMigration).not.toMatch(/DROP\s+(TABLE|COLUMN)/iu);
    expect(sourceRestoreMigration).toContain(
      "CREATE TABLE IF NOT EXISTS source_version_restore_events",
    );
    expect(sourceRestoreMigration).toContain(
      "UNIQUE (actor_user_id, request_id)",
    );
    expect(documentRevisionMigration).not.toMatch(/DROP\s+(TABLE|COLUMN)/iu);
    expect(documentRevisionMigration).toContain(
      "CREATE TABLE IF NOT EXISTS layer_document_revisions",
    );
    expect(documentRevisionMigration).toContain(
      "PRIMARY KEY (project_id, source_version_id, revision)",
    );
    expect(workerResourceMigration).not.toMatch(/DROP\s+(TABLE|COLUMN)/iu);
    expect(workerResourceMigration).toContain(
      "ADD COLUMN IF NOT EXISTS resident_memory_bytes",
    );
    expect(projectReviewMigration).not.toMatch(/DROP\s+(TABLE|COLUMN)/iu);
    expect(projectReviewMigration).toContain(
      "CREATE TABLE IF NOT EXISTS project_review_approvals",
    );
    expect(projectReviewMigration).toContain(
      "UNIQUE (actor_user_id, operation_id)",
    );
    expect(projectReviewMigration).toContain(
      "ADD COLUMN IF NOT EXISTS current_review_approval_id",
    );
    expect(uploadIntegrityMigration).not.toMatch(/DROP\s+(TABLE|COLUMN)/iu);
    expect(uploadIntegrityMigration).toContain(
      "CREATE TABLE IF NOT EXISTS upload_integrity_events",
    );
    expect(uploadIntegrityMigration).toContain("UNIQUE (upload_id)");
    expect(idempotencyFingerprintMigration).not.toMatch(
      /RENAME\s+COLUMN|DROP\s+COLUMN/iu,
    );
    expect(idempotencyFingerprintMigration).toContain(
      "ADD COLUMN IF NOT EXISTS request_hash",
    );
    expect(exportPreflightMigration).toContain(
      "WHERE status = 'preflight'",
    );
    expect(exportPreflightMigration).not.toContain("'preflight',");
    expect(sourceRestoreIdentityMigration).not.toMatch(
      /RENAME\s+COLUMN|DROP\s+COLUMN/iu,
    );
    expect(sourceRestoreIdentityMigration).toContain(
      "ADD COLUMN IF NOT EXISTS idempotency_key",
    );
    expect(sourceRestoreIdentityMigration).toContain(
      "ADD COLUMN IF NOT EXISTS originating_request_id",
    );
    expect(sourceRestoreIdentityMigration).toContain(
      "ADD COLUMN IF NOT EXISTS operation_id",
    );
    expect(sourceRestoreIdentityMigration).toContain(
      "source_version_restore_events_sync_identity",
    );
    expect(uploadCancellationMigration).not.toMatch(
      /RENAME\s+COLUMN|DROP\s+COLUMN/iu,
    );
    expect(uploadCancellationMigration).toContain(
      "ADD COLUMN IF NOT EXISTS project_status_before_upload",
    );
    expect(uploadCancellationMigration).toContain(
      "upload_sessions_cancel_cleanup_idx",
    );
    expect(accountPrivacyMigration).not.toMatch(
      /RENAME\s+COLUMN|DROP\s+(TABLE|COLUMN)/iu,
    );
    expect(accountPrivacyMigration).toContain(
      "CREATE TABLE IF NOT EXISTS account_deletion_requests",
    );
    expect(accountPrivacyMigration).toContain(
      "ADD COLUMN IF NOT EXISTS legal_accepted_at",
    );
    expect(characterRigMigration).not.toMatch(
      /RENAME\s+COLUMN|DROP\s+(TABLE|COLUMN)/iu,
    );
    expect(characterRigMigration).toContain(
      "CREATE TABLE IF NOT EXISTS character_bibles",
    );
    expect(characterRigMigration).toContain(
      "CREATE TABLE IF NOT EXISTS character_generation_attempts",
    );
    expect(characterRigMigration).toContain(
      "CREATE TABLE IF NOT EXISTS character_jobs",
    );
    expect(characterRigMigration).toContain(
      "FOREIGN KEY (bible_id, project_id)",
    );
    expect(characterWorkerObservabilityMigration).not.toMatch(
      /RENAME\s+COLUMN|DROP\s+(TABLE|COLUMN)/iu,
    );
    expect(characterWorkerObservabilityMigration).toContain(
      "worker_heartbeats_worker_type_check",
    );
    expect(characterWorkerObservabilityMigration).toContain(
      "worker_events_worker_type_check",
    );
    expect(characterWorkerObservabilityMigration).toContain(
      "worker_duration_metrics_worker_type_check",
    );
    expect(characterWorkerObservabilityMigration.match(/'character'/gu)).toHaveLength(3);
    expect(privacyRetentionMigration).not.toMatch(
      /RENAME\s+COLUMN|DROP\s+(TABLE|COLUMN)/iu,
    );
    expect(privacyRetentionMigration).toContain("phase IN ('draining', 'purging', 'completed')");
    expect(privacyRetentionMigration).toContain("processing_jobs_prevent_tombstoned_insert");
    expect(privacyRetentionMigration).toContain("export_jobs_prevent_tombstoned_insert");
    expect(privacyRetentionMigration).toContain("character_jobs_prevent_tombstoned_insert");
    expect(privacyRetentionMigration).toContain("upload_sessions_prevent_tombstoned_insert");
    expect(privacyRetentionMigration).toContain("derived_assets_prevent_tombstoned_insert");
    expect(privacyRetentionMigration).toContain("owner.deleted_at IS NULL");
    expect(privacyRetentionMigration).toContain("FOR KEY SHARE OF owner");
    expect(privacyRetentionMigration).toContain("projects_prevent_tombstoned_insert");
    expect(privacyRetentionMigration).toContain(
      "subscriptions_prevent_tombstoned_billable_transition",
    );
    expect(privacyRetentionMigration).toContain(
      "CREATE TABLE IF NOT EXISTS object_write_leases",
    );
    expect(privacyRetentionMigration).toContain(
      "object_write_leases_validate_owner",
    );
    expect(privacyRetentionMigration).toContain(
      "account_deletion_requests_completed_phase_check",
    );
    expect(privacyRetentionMigration).toContain(
      "cardinality(request.object_prefixes) = 0",
    );
    expect(privacyRetentionMigration).toContain(
      "export_jobs_prevent_tombstoned_publication",
    );
    expect(privacyRetentionMigration).toContain(
      "character_generations_prevent_tombstoned_publication",
    );
    expect(privacyRetentionMigration).toContain(
      "NEW.status IN ('draft', 'training', 'ready')",
    );
    expect(privacyRetentionMigration).toContain("layer_documents_lock_object_keys");
    expect(privacyRetentionMigration).toContain("purge_claimed_at");
  });
});
