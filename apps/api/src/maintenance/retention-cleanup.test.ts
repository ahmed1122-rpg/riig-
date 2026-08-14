import { describe, expect, it, vi } from "vitest";
import { InMemoryObjectStorage } from "../storage/object-storage.js";
import {
  AccountDeletionProcessor,
  type AccountPrivacyRepository,
} from "../privacy/account-privacy.js";
import type { RetentionConfig } from "./retention-config.js";
import {
  RetentionCleanup,
  exportArtifactKey,
  type RetentionDatabaseCounts,
  type RetentionStore,
} from "./retention-cleanup.js";
import { PostgresRetentionStore } from "./postgres-retention-store.js";

const config: RetentionConfig = {
  RETENTION_BATCH_SIZE: 100,
  RETENTION_RUN_INTERVAL_MINUTES: 60,
  JOB_RETENTION_DAYS: 90,
  AUDIT_RETENTION_DAYS: 400,
  USAGE_LEDGER_RETENTION_DAYS: 400,
  WORKER_HEARTBEAT_RETENTION_DAYS: 7,
  WORKER_EVENT_RETENTION_DAYS: 30,
};

const emptyCounts: RetentionDatabaseCounts = {
  sessions: 0,
  mfaEnrollments: 0,
  mfaChallenges: 0,
  passwordResetTokens: 0,
  emailVerificationTokens: 0,
  emailOutbox: 0,
  idempotencyKeys: 0,
  objectWriteLeases: 0,
  checkoutSessionsCancelled: 0,
  workerHeartbeats: 0,
  workerEvents: 0,
  usageLedgerEvents: 0,
  auditEvents: 0,
  processingJobs: 0,
  exportJobs: 0,
  uploadSessions: 0,
  sourceVersions: 0,
  uploadIntegrityEvents: 0,
  characterJobs: 0,
};

function successfulClaims(): Pick<
  RetentionStore,
  | "claimUploadPurge"
  | "claimArtifactPurge"
  | "claimCharacterReferencePurge"
  | "claimDerivedAssetPurge"
> {
  return {
    async claimUploadPurge() { return true; },
    async claimArtifactPurge() { return true; },
    async claimCharacterReferencePurge() { return true; },
    async claimDerivedAssetPurge() { return true; },
  };
}

describe("retention cleanup", () => {
  it("purges expired objects and marks them only after storage deletion", async () => {
    const storage = new InMemoryObjectStorage();
    await storage.put({
      key: "sources/project/upload.png",
      contentType: "image/png",
      sizeBytes: 1,
      body: Buffer.from([1]),
    });
    await storage.put({
      key: "artifacts/project/export/result.psd",
      contentType: "application/octet-stream",
      sizeBytes: 1,
      body: Buffer.from([2]),
    });
    await storage.put({
      key: "projects/project/character-rig/references/reference.png",
      contentType: "image/png",
      sizeBytes: 1,
      body: Buffer.from([3]),
    });
    await storage.put({
      key: "derived/project/source/revision-1/orphan.png",
      contentType: "image/png",
      sizeBytes: 1,
      body: Buffer.from([4]),
    });
    const marked: string[] = [];
    const store: RetentionStore = {
      ...successfulClaims(),
      async listExpiredUploads() {
        return [
          {
            uploadId: "upload",
            objectKey: "sources/project/upload.png",
          },
        ];
      },
      async markUploadPurged(id) {
        marked.push(id);
        return true;
      },
      async listExpiredArtifacts() {
        return [
          {
            exportId: "export",
            objectKey: "artifacts/project/export/result.psd",
          },
        ];
      },
      async markArtifactPurged(id) {
        marked.push(id);
        return true;
      },
      async listExpiredCharacterReferences() {
        return [{
          referenceId: "reference",
          objectKey: "projects/project/character-rig/references/reference.png",
        }];
      },
      async markCharacterReferencePurged(id) {
        marked.push(id);
        return true;
      },
      async listUnreferencedDerivedAssets() {
        return [
          {
            objectKey: "derived/project/source/revision-1/orphan.png",
            observedUpdatedAt: "2026-07-28T10:00:00.000Z",
          },
        ];
      },
      async markDerivedAssetPurged(objectKey) {
        marked.push(objectKey);
        return true;
      },
      async pruneDatabase() {
        return emptyCounts;
      },
    };

    const report = await new RetentionCleanup(
      store,
      storage,
      config,
      () => new Date("2026-07-28T12:00:00.000Z"),
    ).run();

    expect(report).toMatchObject({
      checkedAt: "2026-07-28T12:00:00.000Z",
      uploadsPurged: 1,
      artifactsPurged: 1,
      characterReferencesPurged: 1,
      derivedAssetsPurged: 1,
      failures: [],
    });
    expect(marked).toEqual([
      "upload",
      "export",
      "reference",
      "derived/project/source/revision-1/orphan.png",
    ]);
    await expect(storage.get("sources/project/upload.png")).resolves.toBeNull();
    await expect(
      storage.get("artifacts/project/export/result.psd"),
    ).resolves.toBeNull();
    await expect(
      storage.get("projects/project/character-rig/references/reference.png"),
    ).resolves.toBeNull();
    await expect(
      storage.get("derived/project/source/revision-1/orphan.png"),
    ).resolves.toBeNull();
  });

  it("keeps database state retryable when an object deletion fails", async () => {
    const marked: string[] = [];
    const store: RetentionStore = {
      ...successfulClaims(),
      async listExpiredUploads() {
        return [{ uploadId: "upload", objectKey: "sources/failed.png" }];
      },
      async markUploadPurged(id) {
        marked.push(id);
        return true;
      },
      async listExpiredArtifacts() {
        return [];
      },
      async markArtifactPurged() {
        return true;
      },
      async listExpiredCharacterReferences() {
        return [];
      },
      async markCharacterReferencePurged() {
        return false;
      },
      async listUnreferencedDerivedAssets() {
        return [];
      },
      async markDerivedAssetPurged() {
        return false;
      },
      async pruneDatabase() {
        return emptyCounts;
      },
    };
    const storage = {
      async put() {
        return {
          key: "unused",
          contentType: "application/octet-stream",
          sizeBytes: 0,
          sha256: "0".repeat(64),
        };
      },
      async inspect() {
        return null;
      },
      async get() {
        return null;
      },
      async getStream() {
        return null;
      },
      async list() {
        return [];
      },
      async purge() {},
      async delete() {
        throw new Error("storage unavailable");
      },
    };

    const report = await new RetentionCleanup(
      store,
      storage,
      config,
    ).run();

    expect(marked).toEqual([]);
    expect(report.failures).toEqual([
      {
        key: "sources/failed.png",
        message: "storage unavailable",
      },
    ]);
  });

  it("surfaces failed durable account deletion through maintenance", async () => {
    const request = {
      id: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      status: "processing" as const,
      phase: "purging" as const,
      objectKeys: ["sources/private.png"],
      objectPrefixes: [],
      attempt: 1,
      requestedAt: "2026-08-04T10:00:00.000Z",
      updatedAt: "2026-08-04T10:00:00.000Z",
      completedAt: null,
      drainedAt: "2026-08-04T10:00:00.000Z",
    };
    const repository: AccountPrivacyRepository = {
      async exportAccount() { throw new Error("not used"); },
      async prepareDeletion() { return { kind: "ready", request }; },
      async listPendingDeletions() { return [request]; },
      async claimDeletion() { return true; },
      async reconcileDeletion() { return { kind: "ready", request }; },
      async recordDeletionInventory() { return request; },
      async markDeletionFailed() {},
      async completeDeletion() {},
    };
    const storage = new InMemoryObjectStorage();
    storage.purge = () => Promise.reject("temporary outage");
    const store: RetentionStore = {
      ...successfulClaims(),
      async listExpiredUploads() { return []; },
      async markUploadPurged() { return false; },
      async listExpiredArtifacts() { return []; },
      async markArtifactPurged() { return false; },
      async listExpiredCharacterReferences() { return []; },
      async markCharacterReferencePurged() { return false; },
      async listUnreferencedDerivedAssets() { return []; },
      async markDerivedAssetPurged() { return false; },
      async pruneDatabase() { return emptyCounts; },
    };

    const report = await new RetentionCleanup(
      store,
      storage,
      config,
      () => new Date("2026-08-04T10:01:00.000Z"),
      {
        repository,
        processor: new AccountDeletionProcessor(repository, storage),
      },
    ).run();

    expect(report.failures).toEqual([
      {
        key: `account-deletion:${request.id}`,
        message: "One or more private objects could not be deleted.",
      },
    ]);
  });

  it("keeps the object when a reference wins the claim race 50 times", async () => {
    for (let iteration = 0; iteration < 50; iteration += 1) {
      const key = `derived/project/source/race-${iteration}.png`;
      const storage = new InMemoryObjectStorage();
      await storage.put({
        key,
        contentType: "image/png",
        sizeBytes: 1,
        body: Buffer.from([1]),
      });
      let referenceAdded = false;
      const store: RetentionStore = {
        ...successfulClaims(),
        async listExpiredUploads() { return []; },
        async markUploadPurged() { return false; },
        async listExpiredArtifacts() { return []; },
        async markArtifactPurged() { return false; },
        async listExpiredCharacterReferences() { return []; },
        async markCharacterReferencePurged() { return false; },
        async listUnreferencedDerivedAssets() {
          return [{
            objectKey: key,
            observedUpdatedAt: "2026-08-13T08:00:00.000Z",
          }];
        },
        async claimDerivedAssetPurge() {
          referenceAdded = true;
          return false;
        },
        async markDerivedAssetPurged() { return false; },
        async pruneDatabase() { return emptyCounts; },
      };

      const report = await new RetentionCleanup(
        store,
        storage,
        config,
        () => new Date("2026-08-13T10:00:00.000Z"),
      ).run();

      expect(referenceAdded).toBe(true);
      expect(report.derivedAssetsPurged).toBe(0);
      await expect(storage.inspect(key)).resolves.not.toBeNull();
    }
  });

  it("derives the same private artifact key used by the export service", () => {
    expect(exportArtifactKey("project", "export", "result.psd")).toBe(
      "artifacts/project/export/result.psd",
    );
  });

  it("prefers immutable artifact metadata and falls back for historical rows", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "current-export",
          project_id: "project",
          filename: "current.psd",
          object_key:
            "artifacts/project/current-export/generations/generation/current.psd",
        },
        {
          id: "legacy-export",
          project_id: "project",
          filename: "legacy.psd",
          object_key: null,
        },
      ],
    });
    const store = new PostgresRetentionStore({ query } as never);

    await expect(
      store.listExpiredArtifacts("2026-07-28T12:00:00.000Z", 100),
    ).resolves.toEqual([
      {
        exportId: "current-export",
        objectKey:
          "artifacts/project/current-export/generations/generation/current.psd",
      },
      {
        exportId: "legacy-export",
        objectKey: "artifacts/project/legacy-export/legacy.psd",
      },
    ]);
  });

  it("lists only aged unreferenced registry keys and fences their purge", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            object_key: "derived/project/source/orphan.png",
            updated_at: "2026-07-28T10:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});
    const client = { query, release: vi.fn() };
    const store = new PostgresRetentionStore({
      query,
      connect: vi.fn().mockResolvedValue(client),
    } as never);

    await expect(
      store.listUnreferencedDerivedAssets(
        "2026-07-28T12:00:00.000Z",
        100,
      ),
    ).resolves.toEqual([
      {
        objectKey: "derived/project/source/orphan.png",
        observedUpdatedAt: "2026-07-28T10:00:00.000Z",
      },
    ]);
    expect(query.mock.calls[0]?.[0]).toContain("layer_document_revisions");
    expect(query.mock.calls[0]?.[0]).toContain("interval '1 hour'");

    await expect(
      store.claimDerivedAssetPurge(
        {
          objectKey: "derived/project/source/orphan.png",
          observedUpdatedAt: "2026-07-28T10:00:00.000Z",
        },
        "2026-07-28T12:00:00.000Z",
      ),
    ).resolves.toBe(true);
    expect(String(query.mock.calls[3]?.[0])).toContain("purge_claimed_at");

    query.mockResolvedValueOnce({ rowCount: 1 });
    await expect(
      store.markDerivedAssetPurged(
        "derived/project/source/orphan.png",
        "2026-07-28T10:00:00.000Z",
        "2026-07-28T12:00:00.000Z",
      ),
    ).resolves.toBe(true);
    expect(String(query.mock.calls.at(-1)?.[0])).toContain(
      "purge_claimed_at = $2",
    );
    expect(query.mock.calls.at(-1)?.[1]).toEqual([
      "derived/project/source/orphan.png",
      "2026-07-28T12:00:00.000Z",
    ]);
  });
});
