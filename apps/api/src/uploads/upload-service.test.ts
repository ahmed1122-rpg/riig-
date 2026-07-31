import { describe, expect, it } from "vitest";
import { InMemoryIdempotencyStore } from "../idempotency/idempotency-store.js";
import { InMemorySourceVersionRepository } from "../sources/source-version-repository.js";
import { InMemoryObjectStorage } from "../storage/object-storage.js";
import { InMemoryUploadRepository } from "./upload-repository.js";
import { UploadService } from "./upload-service.js";

describe("UploadService", () => {
  it("expires stale sessions before creating the next source version", async () => {
    const uploads = new InMemoryUploadRepository();
    const sourceVersions = new InMemorySourceVersionRepository();
    const storage = new InMemoryObjectStorage();
    let clock = new Date("2026-07-28T08:00:00.000Z");
    const service = new UploadService(
      uploads,
      () => clock,
      new InMemoryIdempotencyStore(),
      storage,
      sourceVersions,
    );
    const projectId = crypto.randomUUID();
    const first = await service.createIntent(
      {
        projectId,
        filename: "first.png",
        contentType: "image/png",
        sizeBytes: 128,
      },
      "first-upload",
    );

    clock = new Date("2026-07-28T08:11:00.000Z");
    const second = await service.createIntent(
      {
        projectId,
        filename: "second.png",
        contentType: "image/png",
        sizeBytes: 128,
        replaceSourceVersion: true,
      },
      "second-upload",
    );

    expect((await service.find(first.uploadId)).status).toBe("cancelled");
    expect((await service.findSourceVersion(first.uploadId))?.status).toBe(
      "cancelled",
    );
    expect(second.sourceVersionId).not.toBe(first.sourceVersionId);
    expect((await service.findSourceVersion(second.uploadId))?.versionNumber).toBe(
      2,
    );
  });
});
