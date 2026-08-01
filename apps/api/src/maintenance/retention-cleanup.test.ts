import { describe, expect, it } from "vitest";
import { InMemoryObjectStorage } from "../storage/object-storage.js";
import type { RetentionConfig } from "./retention-config.js";
import {
  RetentionCleanup,
  exportArtifactKey,
  type RetentionDatabaseCounts,
  type RetentionStore,
} from "./retention-cleanup.js";

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
  emailOutbox: 0,
  idempotencyKeys: 0,
  checkoutSessionsCancelled: 0,
  workerHeartbeats: 0,
  workerEvents: 0,
  usageLedgerEvents: 0,
  auditEvents: 0,
  processingJobs: 0,
  exportJobs: 0,
  uploadSessions: 0,
  sourceVersions: 0,
};

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
    const marked: string[] = [];
    const store: RetentionStore = {
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
      failures: [],
    });
    expect(marked).toEqual(["upload", "export"]);
    await expect(storage.get("sources/project/upload.png")).resolves.toBeNull();
    await expect(
      storage.get("artifacts/project/export/result.psd"),
    ).resolves.toBeNull();
  });

  it("keeps database state retryable when an object deletion fails", async () => {
    const marked: string[] = [];
    const store: RetentionStore = {
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

  it("derives the same private artifact key used by the export service", () => {
    expect(exportArtifactKey("project", "export", "result.psd")).toBe(
      "artifacts/project/export/result.psd",
    );
  });
});
