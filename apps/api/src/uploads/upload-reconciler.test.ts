import { describe, expect, it, vi } from "vitest";
import { InMemoryObjectStorage } from "../storage/object-storage.js";
import { UploadReconciler } from "./upload-reconciler.js";
import type { UploadFinalizationCommand } from "./upload-finalization.js";

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

    const report = await new UploadReconciler(command, storage).runOnce();
    expect(report).toEqual({ inspected: 1, repaired: 1, failed: [] });
    expect(finalize).toHaveBeenCalledWith({
      session,
      sha256: stored.sha256,
    });
  });

  it("reports missing, changed, and failed candidate repairs independently", async () => {
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

    const report = await new UploadReconciler(command, storage).runOnce(3);

    expect(command.findCandidates).toHaveBeenCalledWith(3);
    expect(report).toEqual({
      inspected: 3,
      repaired: 0,
      failed: [
        { uploadId: "missing", code: "UPLOAD_STORAGE_MISMATCH" },
        { uploadId: "hash", code: "UPLOAD_HASH_MISMATCH" },
        { uploadId: "repair", code: "UPLOAD_RECONCILIATION_FAILED" },
      ],
    });
  });

  it("is idle without candidate discovery and runs its scheduled audit once", async () => {
    const storage = new InMemoryObjectStorage();
    const withoutDiscovery = new UploadReconciler(
      { finalize: vi.fn() },
      storage,
    );
    await expect(withoutDiscovery.runOnce()).resolves.toEqual({
      inspected: 0,
      repaired: 0,
      failed: [],
    });
    withoutDiscovery.start();
    await withoutDiscovery.stop();

    vi.useFakeTimers();
    try {
      const findCandidates = vi.fn(async () => []);
      const scheduled = new UploadReconciler(
        { finalize: vi.fn(), findCandidates },
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
});

function sessionFor(uploadId: string, objectKey: string, expectedSizeBytes: number) {
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
