import type { ExportJob } from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryExportRepository } from "./export-repository.js";

function queuedJob(timestamp: string): ExportJob {
  return {
    id: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    sourceVersionId: crypto.randomUUID(),
    projectKind: "image",
    format: "psd",
    scope: "full-document",
    scale: 1,
    colorProfile: "sRGB",
    namingPresetId: "adobe-default",
    status: "queued",
    progress: 0,
    attempt: 0,
    maxAttempts: 3,
    nextAttemptAt: timestamp,
    leaseOwner: null,
    leaseExpiresAt: null,
    errorCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("InMemoryExportRepository leases", () => {
  it("prevents duplicate claims and recovers an expired lease", async () => {
    const repository = new InMemoryExportRepository();
    const job = queuedJob("2026-07-28T08:00:00.000Z");
    await repository.save(job);

    const first = await repository.claimNext(
      "worker-a",
      "2026-07-28T08:00:00.000Z",
      "2026-07-28T08:05:00.000Z",
    );
    const duplicate = await repository.claimNext(
      "worker-b",
      "2026-07-28T08:01:00.000Z",
      "2026-07-28T08:06:00.000Z",
    );
    const recovered = await repository.claimNext(
      "worker-b",
      "2026-07-28T08:05:01.000Z",
      "2026-07-28T08:10:01.000Z",
    );

    expect(first).toMatchObject({
      id: job.id,
      attempt: 1,
      leaseOwner: "worker-a",
    });
    expect(duplicate).toBeNull();
    expect(recovered).toMatchObject({
      id: job.id,
      attempt: 2,
      leaseOwner: "worker-b",
    });
  });

  it("backs off retries and makes cancellation win over a worker update", async () => {
    const repository = new InMemoryExportRepository();
    const job = queuedJob("2026-07-28T08:00:00.000Z");
    await repository.save(job);
    await repository.claimNext(
      "worker-a",
      "2026-07-28T08:00:00.000Z",
      "2026-07-28T08:05:00.000Z",
    );
    const retry = await repository.retryOrFailClaim(
      job.id,
      "worker-a",
      "STORAGE_UNAVAILABLE",
      "2026-07-28T08:00:10.000Z",
      "2026-07-28T08:00:01.000Z",
    );

    expect(retry).toMatchObject({
      status: "queued",
      attempt: 1,
      errorCode: "STORAGE_UNAVAILABLE",
    });
    expect(
      await repository.claimNext(
        "worker-b",
        "2026-07-28T08:00:05.000Z",
        "2026-07-28T08:05:05.000Z",
      ),
    ).toBeNull();
    const claimed = await repository.claimNext(
      "worker-b",
      "2026-07-28T08:00:11.000Z",
      "2026-07-28T08:05:11.000Z",
    );
    expect(claimed?.attempt).toBe(2);

    const cancelled = await repository.requestCancel(
      job.id,
      "2026-07-28T08:00:12.000Z",
    );
    const lateWorkerUpdate = await repository.updateClaim(
      job.id,
      "worker-b",
      { status: "ready", progress: 100 },
      "2026-07-28T08:00:13.000Z",
    );
    expect(cancelled?.status).toBe("cancelled");
    expect(lateWorkerUpdate).toBeNull();
  });

  it("requeues only terminal failures and clears stale artifact state", async () => {
    const repository = new InMemoryExportRepository();
    const failed: ExportJob = {
      ...queuedJob("2026-07-28T08:00:00.000Z"),
      status: "failed",
      progress: 80,
      attempt: 3,
      errorCode: "STORAGE_UNAVAILABLE",
      artifact: {
        filename: "partial.zip",
        sizeBytes: 10,
        sha256: "a".repeat(64),
        expiresAt: "2026-07-29T08:00:00.000Z",
      },
    };
    await repository.save(failed);

    const retried = await repository.retryFailed(
      failed.id,
      "2026-07-28T09:00:00.000Z",
    );

    expect(retried).toMatchObject({
      status: "queued",
      progress: 0,
      attempt: 0,
      errorCode: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    expect(retried).not.toHaveProperty("artifact");
    await expect(
      repository.retryFailed(failed.id, "2026-07-28T09:01:00.000Z"),
    ).resolves.toBeNull();
  });
});
