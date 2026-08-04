import { describe, expect, it, vi } from "vitest";
import {
  InMemoryObjectStorage,
  ObjectStorageIntegrityError,
} from "../storage/object-storage.js";
import { UploadReconciler } from "./upload-reconciler.js";
import type { UploadFinalizationCommand } from "./upload-finalization.js";
import type { UploadIntegrityFailureCommand } from "./upload-integrity-failure.js";

describe("upload reconciler", () => {
  it("repairs a verified legacy state without accepting changed bytes", async () => {
    const storage = new InMemoryObjectStorage();
    const body = Buffer.from("verified source");
    const stored = await storage.put({
      key: "sources/project/upload.png",
      body,
      contentType: "image/png",
      sizeBytes: body.byteLength,
    });
    const session = {
      uploadId: "upload",
      projectId: "project",
      filename: "source.png",
      contentType: "image/png" as const,
      expectedSizeBytes: body.byteLength,
      status: "verifying" as const,
      sourceVersionId: "source",
      sha256: null,
      objectKey: stored.key,
      expiresAt: "2026-08-01T12:10:00.000Z",
      maxBytes: 30 * 1024 * 1024,
      uploadUrl: "/v1/uploads/upload/content",
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-01T12:00:00.000Z",
    };
    const finalize = vi.fn(async () => ({
      ...session,
      status: "ready" as const,
      sha256: stored.sha256,
    }));
    const command: UploadFinalizationCommand = {
      finalize,
      findCandidates: vi.fn(async () => [session]),
    };
    const integrity = integrityCommand();

    const report = await new UploadReconciler(
      command,
      integrity,
      storage,
    ).runOnce();
    expect(report).toEqual({
      inspected: 1,
      repaired: 1,
      terminalFailed: 0,
      transientFailed: 0,
      stale: 0,
      failed: [],
    });
    expect(finalize).toHaveBeenCalledWith({
      session,
      sha256: stored.sha256,
    });
    expect(integrity.markIntegrityFailure).not.toHaveBeenCalled();
  });

  it("makes proven missing and changed objects terminal independently", async () => {
    const storage = new InMemoryObjectStorage();
    const stored = await storage.put({
      key: "sources/project/changed.png",
      body: Buffer.from("changed"),
      contentType: "image/png",
      sizeBytes: 7,
    });
    const repairable = {
      ...sessionFor("repair", stored.key, stored.sizeBytes),
      sha256: stored.sha256,
    };
    const command: UploadFinalizationCommand = {
      findCandidates: vi.fn(async () => [
        sessionFor("missing", "sources/project/missing.png", 7),
        {
          ...sessionFor("hash", stored.key, stored.sizeBytes),
          sha256: "0".repeat(64),
        },
        repairable,
      ]),
      finalize: vi.fn(async ({ session }) => {
        if (session.uploadId === "repair") {
          throw new Error("transient database failure");
        }
        return { ...session, status: "ready", sha256: stored.sha256 };
      }),
    };
    const integrity = integrityCommand();

    const report = await new UploadReconciler(
      command,
      integrity,
      storage,
    ).runOnce(3);

    expect(command.findCandidates).toHaveBeenCalledWith(3);
    expect(report).toEqual({
      inspected: 3,
      repaired: 0,
      terminalFailed: 2,
      transientFailed: 1,
      stale: 0,
      failed: [
        {
          uploadId: "missing",
          code: "UPLOAD_OBJECT_MISSING",
          kind: "terminal",
        },
        {
          uploadId: "hash",
          code: "UPLOAD_HASH_MISMATCH",
          kind: "terminal",
        },
        {
          uploadId: "repair",
          code: "UPLOAD_RECONCILIATION_FAILED",
          kind: "transient",
        },
      ],
    });
    expect(integrity.markIntegrityFailure).toHaveBeenCalledTimes(2);
  });

  it("separates corrupt metadata and provider outages", async () => {
    const corrupt = sessionFor("corrupt", "sources/project/corrupt.png", 7);
    const outage = sessionFor("outage", "sources/project/outage.png", 7);
    const storage = new InMemoryObjectStorage();
    vi.spyOn(storage, "inspect").mockImplementation(async (key) => {
      if (key === corrupt.objectKey) {
        throw new ObjectStorageIntegrityError(key);
      }
      throw new Error("provider unavailable");
    });
    const integrity = integrityCommand();
    const report = await new UploadReconciler(
      {
        finalize: vi.fn(),
        findCandidates: vi.fn(async () => [corrupt, outage]),
      },
      integrity,
      storage,
    ).runOnce();

    expect(report.terminalFailed).toBe(1);
    expect(report.transientFailed).toBe(1);
    expect(report.failed).toEqual([
      {
        uploadId: "corrupt",
        code: "UPLOAD_OBJECT_METADATA_INVALID",
        kind: "terminal",
      },
      {
        uploadId: "outage",
        code: "UPLOAD_STORAGE_INSPECTION_FAILED",
        kind: "transient",
      },
    ]);
  });

  it("reports a stale terminal observation without double counting it", async () => {
    const storage = new InMemoryObjectStorage();
    const session = sessionFor("stale", "sources/project/missing.png", 7);
    const integrity = integrityCommand("stale_candidate");
    const report = await new UploadReconciler(
      {
        finalize: vi.fn(),
        findCandidates: vi.fn(async () => [session]),
      },
      integrity,
      storage,
    ).runOnce();

    expect(report).toMatchObject({ terminalFailed: 0, stale: 1 });
    expect(report.failed[0]).toMatchObject({
      code: "UPLOAD_RECONCILIATION_STALE",
      kind: "stale",
    });
  });

  it("records candidate discovery failure instead of silently swallowing it", async () => {
    const report = await new UploadReconciler(
      {
        finalize: vi.fn(),
        findCandidates: vi.fn(async () => {
          throw new Error("database unavailable");
        }),
      },
      integrityCommand(),
      new InMemoryObjectStorage(),
    ).runOnce();

    expect(report).toMatchObject({ inspected: 0, transientFailed: 1 });
    expect(report.failed[0]).toEqual({
      uploadId: null,
      code: "UPLOAD_CANDIDATE_DISCOVERY_FAILED",
      kind: "transient",
    });
  });

  it("is idle without candidate discovery and runs its scheduled audit once", async () => {
    const storage = new InMemoryObjectStorage();
    const withoutDiscovery = new UploadReconciler(
      { finalize: vi.fn() },
      integrityCommand(),
      storage,
    );
    await expect(withoutDiscovery.runOnce()).resolves.toEqual({
      inspected: 0,
      repaired: 0,
      terminalFailed: 0,
      transientFailed: 0,
      stale: 0,
      failed: [],
    });
    withoutDiscovery.start();
    await withoutDiscovery.stop();

    vi.useFakeTimers();
    try {
      const findCandidates = vi.fn(async () => []);
      const scheduled = new UploadReconciler(
        { finalize: vi.fn(), findCandidates },
        integrityCommand(),
        storage,
      );
      scheduled.start();
      scheduled.start();
      await vi.advanceTimersByTimeAsync(0);
      await scheduled.stop();

      expect(findCandidates).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces an unexpected scheduled-cycle failure", async () => {
    vi.useFakeTimers();
    try {
      const storage = new InMemoryObjectStorage();
      const cycleError = vi.fn();
      const scheduled = new UploadReconciler(
        { finalize: vi.fn(), findCandidates: vi.fn(async () => []) },
        integrityCommand(),
        storage,
        () => {
          throw new Error("metrics unavailable");
        },
        60_000,
        cycleError,
      );

      scheduled.start();
      await vi.advanceTimersByTimeAsync(0);
      await scheduled.stop();

      expect(cycleError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "metrics unavailable" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

function integrityCommand(
  outcome: "transitioned" | "already_terminal" | "stale_candidate" =
    "transitioned",
): UploadIntegrityFailureCommand & {
  markIntegrityFailure: ReturnType<typeof vi.fn>;
} {
  return {
    markIntegrityFailure: vi.fn(async () => ({ outcome })),
  };
}

function sessionFor(
  uploadId: string,
  objectKey: string,
  expectedSizeBytes: number,
) {
  return {
    uploadId,
    projectId: "project",
    filename: `${uploadId}.png`,
    contentType: "image/png" as const,
    expectedSizeBytes,
    status: "verifying" as const,
    sourceVersionId: `source-${uploadId}`,
    sha256: null,
    objectKey,
    expiresAt: "2026-08-01T12:10:00.000Z",
    maxBytes: 30 * 1024 * 1024,
    uploadUrl: `/v1/uploads/${uploadId}/content`,
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
  };
}
