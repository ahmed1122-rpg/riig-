import type { ExportJob, ProcessingJob } from "@motionprep/contracts";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  releaseExportJobForShutdown,
  releaseProcessingJobForShutdown,
} from "./worker-shutdown-requeue.js";

const timestamp = "2026-07-31T00:00:00.000Z";

describe("worker shutdown lease release", () => {
  it("requeues a processing lease without consuming an attempt", async () => {
    const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
    const pool = {
      async query(sql: string, values?: unknown[]) {
        calls.push({ sql, values });
        return { rowCount: 1 };
      },
    } as unknown as Pool;
    const job: ProcessingJob = {
      id: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      sourceVersionId: crypto.randomUUID(),
      projectKind: "image",
      options: {},
      status: "processing",
      progress: 25,
      attempt: 1,
      maxAttempts: 3,
      nextAttemptAt: timestamp,
      leaseOwner: "media:1",
      leaseExpiresAt: timestamp,
      errorCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await expect(
      releaseProcessingJobForShutdown(pool, job, "media:1"),
    ).resolves.toBe(true);
    expect(calls[0]?.sql).toContain("attempt = GREATEST(0, attempt - 1)");
    expect(calls[0]?.sql).toContain("WORKER_SHUTDOWN_REQUEUE");
    expect(calls[0]?.values).toEqual([job.id, "media:1"]);
  });

  it("requeues an export lease only for its current owner", async () => {
    const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
    const pool = {
      async query(sql: string, values?: unknown[]) {
        calls.push({ sql, values });
        return { rowCount: 0 };
      },
    } as unknown as Pool;
    const job: ExportJob = {
      id: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      sourceVersionId: crypto.randomUUID(),
      projectKind: "book",
      documentRevision: 1,
      format: "psd",
      scope: "full-document",
      scale: 1,
      colorProfile: "sRGB",
      namingPresetId: "adobe-default",
      status: "generating",
      progress: 25,
      attempt: 1,
      maxAttempts: 3,
      nextAttemptAt: timestamp,
      leaseOwner: "export:1",
      leaseExpiresAt: timestamp,
      errorCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await expect(
      releaseExportJobForShutdown(pool, job, "stale-owner"),
    ).resolves.toBe(false);
    expect(calls[0]?.sql).toContain("lease_owner = $2");
    expect(calls[0]?.values).toEqual([job.id, "stale-owner"]);
  });
});
