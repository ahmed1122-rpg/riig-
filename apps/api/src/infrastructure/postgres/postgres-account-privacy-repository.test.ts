import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresAccountPrivacyRepository } from "./postgres-account-privacy-repository.js";

describe("PostgresAccountPrivacyRepository", () => {
  it("defensively hydrates legacy pending rows and claims one processor", async () => {
    const query = vi.fn(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.startsWith("SELECT * FROM account_deletion_requests")) {
        return {
          rows: [{
            id: "deletion-legacy",
            user_id: "user-1",
            status: "processing",
            phase: null,
            object_keys: null,
            object_prefixes: null,
            attempt: 1,
            requested_at: "2026-08-12T00:00:00.000Z",
            updated_at: "2026-08-12T00:00:00.000Z",
            completed_at: null,
            drained_at: null,
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const repository = new PostgresAccountPrivacyRepository({ query } as unknown as Pool);

    await expect(repository.listPendingDeletions(10)).resolves.toEqual([
      expect.objectContaining({
        id: "deletion-legacy",
        phase: "draining",
        objectKeys: [],
        objectPrefixes: [],
      }),
    ]);
    await expect(repository.claimDeletion(
      "deletion-legacy",
      "processor-1",
      "2026-08-12T00:00:00.000Z",
      "2026-08-12T01:00:00.000Z",
    )).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        "processor_lease_expires_at <= clock_timestamp()",
      ),
      [
        "deletion-legacy",
        "processor-1",
        "2026-08-12T00:00:00.000Z",
        "2026-08-12T01:00:00.000Z",
      ],
    );
  });

  it("exports owned editor and Character records without provider handles", async () => {
    const query = vi.fn(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.includes("FROM users")) {
        return {
          rows: [{
            id: "user-1",
            name: "Owner",
            email: "owner@example.com",
            role: "user",
            status: "active",
            mfaEnabled: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            lastLoginAt: null,
            terms_version: "2026-01",
            privacy_version: "2026-01",
            legal_accepted_at: "2026-01-01T00:00:00.000Z",
          }],
          rowCount: 1,
        };
      }
      const characterTable = sql.match(/FROM (character_[a-z_]+) record/iu)?.[1];
      if (characterTable) {
        return {
          rows: [{
            document: {
              kind: characterTable,
              artifact: { objectKey: "private/key", sizeBytes: 12 },
            },
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM layer_documents document")) {
        return { rows: [{ document: { kind: "layer-document" } }], rowCount: 1 };
      }
      if (sql.includes("FROM layer_document_revisions revision")) {
        return { rows: [{ document: { kind: "layer-revision" } }], rowCount: 1 };
      }
      if (sql.includes("FROM source_version_restore_events event")) {
        return { rows: [{ kind: "restore" }], rowCount: 1 };
      }
      if (sql.includes("FROM processing_jobs job")) {
        return { rows: [{ kind: "processing-job" }], rowCount: 1 };
      }
      if (sql.includes("FROM project_review_approvals approval")) {
        return { rows: [{ kind: "approval" }], rowCount: 1 };
      }
      if (sql.includes("FROM character_identity_model_versions model")) {
        return { rows: [{ document: { kind: "identity-model" } }], rowCount: 1 };
      }
      if (sql.includes("FROM character_jobs job")) {
        return { rows: [{ document: { kind: "character-job" } }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const release = vi.fn();
    const repository = new PostgresAccountPrivacyRepository({
      connect: vi.fn().mockResolvedValue({ query, release } as unknown as PoolClient),
    } as unknown as Pool);

    const exported = await repository.exportAccount(
      "user-1",
      "2026-08-12T00:00:00.000Z",
    );

    expect(exported.schemaVersion).toBe("2");
    expect(exported.content).toEqual({
      layerDocuments: [{ kind: "layer-document" }],
      layerDocumentRevisions: [{ kind: "layer-revision" }],
      sourceVersionRestores: [{ kind: "restore" }],
      processingJobs: [{ kind: "processing-job" }],
      projectReviewApprovals: [{ kind: "approval" }],
    });
    expect(exported.character).toEqual({
      bibles: [{ kind: "character_bibles", artifact: { sizeBytes: 12 } }],
      references: [{
        kind: "character_reference_assets",
        artifact: { sizeBytes: 12 },
      }],
      identityModels: [{ kind: "identity-model" }],
      generations: [{
        kind: "character_generation_attempts",
        artifact: { sizeBytes: 12 },
      }],
      generationReviews: [{
        kind: "character_generation_reviews",
        artifact: { sizeBytes: 12 },
      }],
      rigs: [{ kind: "character_rig_versions", artifact: { sizeBytes: 12 } }],
      rigReviews: [{
        kind: "character_rig_reviews",
        artifact: { sizeBytes: 12 },
      }],
      jobs: [{ kind: "character-job" }],
    });
    expect(JSON.stringify(exported)).not.toContain("private/key");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("model.document - 'providerKey' - 'providerModelReference'"),
      ["user-1"],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("job.document - 'leaseOwner' - 'leaseExpiresAt'"),
      ["user-1"],
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it("locks projects before the registry and then removes the graph", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      statements.push(sql);
      if (sql.includes("FROM account_deletion_requests")) {
        return {
          rows: [{
            id: "deletion-1",
            user_id: "user-1",
            status: "processing",
            phase: "purging",
            object_keys: [],
            object_prefixes: [],
            attempt: 1,
            requested_at: "2026-08-12T00:00:00.000Z",
            updated_at: "2026-08-12T00:00:00.000Z",
            completed_at: null,
            drained_at: "2026-08-12T00:00:00.000Z",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("SELECT email FROM users")) {
        return { rows: [{ email: "owner@example.com" }], rowCount: 1 };
      }
      if (sql.includes("SELECT 1 FROM (")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });
    const repository = new PostgresAccountPrivacyRepository({
      connect: vi.fn().mockResolvedValue({
        query,
        release: vi.fn(),
      } as unknown as PoolClient),
    } as unknown as Pool);

    await repository.completeDeletion(
      "deletion-1",
      "user-1",
      "2026-08-12T00:00:00.000Z",
      "processor-lease-1",
    );

    const registryDelete = statements.findIndex((sql) =>
      sql.includes("DELETE FROM derived_asset_registry"),
    );
    const projectDelete = statements.findIndex((sql) =>
      sql.includes("DELETE FROM projects"),
    );
    const emailVerificationDelete = statements.findIndex((sql) =>
      sql.includes("DELETE FROM email_verification_tokens"),
    );
    expect(registryDelete).toBeGreaterThan(-1);
    expect(projectDelete).toBeGreaterThan(registryDelete);
    expect(emailVerificationDelete).toBeGreaterThan(projectDelete);
    const projectLock = statements.findIndex((sql) =>
      sql.includes("SELECT id FROM projects") && sql.includes("FOR UPDATE"),
    );
    const registryLock = statements.findIndex((sql) =>
      sql.includes("SELECT object_key FROM derived_asset_registry") &&
      sql.includes("FOR UPDATE"),
    );
    expect(projectLock).toBeGreaterThan(-1);
    expect(registryLock).toBeGreaterThan(projectLock);
  });
});
