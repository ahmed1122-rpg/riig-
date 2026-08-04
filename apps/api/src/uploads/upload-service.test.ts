import { describe, expect, it } from "vitest";
import { InMemoryIdempotencyStore } from "../idempotency/idempotency-store.js";
import { InMemoryProjectRepository } from "../projects/project-repository.js";
import { InMemorySourceVersionRepository } from "../sources/source-version-repository.js";
import {
  InMemoryObjectStorage,
  type StoredObject,
  type StoredObjectMetadata,
} from "../storage/object-storage.js";
import { InMemoryUploadRepository } from "./upload-repository.js";
import { UploadService } from "./upload-service.js";
import { InMemoryUploadFinalizationCommand } from "./upload-finalization.js";
import { InMemoryUploadIntegrityFailureCommand } from "./upload-integrity-failure.js";

class MismatchedObjectStorage extends InMemoryObjectStorage {
  override async put(object: StoredObject): Promise<StoredObjectMetadata> {
    const stored = await super.put(object);
    return { ...stored, sha256: "0".repeat(64) };
  }
}

class MismatchedCleanupFailingObjectStorage extends MismatchedObjectStorage {
  override async delete(): Promise<void> {
    throw new Error("object cleanup unavailable");
  }
}

describe("UploadService", () => {
  it("replays an identical intent and rejects a changed payload for the same key", async () => {
    const service = new UploadService(
      new InMemoryUploadRepository(),
      () => new Date("2026-08-03T12:00:00.000Z"),
      new InMemoryIdempotencyStore(),
      new InMemoryObjectStorage(),
      new InMemorySourceVersionRepository(),
    );
    const input = {
      projectId: crypto.randomUUID(),
      filename: "source.png",
      contentType: "image/png" as const,
      sizeBytes: 128,
    };

    const created = await service.createIntent(input, "stable-upload-key");
    await expect(
      service.createIntent(input, "stable-upload-key"),
    ).resolves.toMatchObject({ uploadId: created.uploadId });
    await expect(
      service.createIntent(
        { ...input, filename: "different.png" },
        "stable-upload-key",
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("enforces the configured limit even when called outside the HTTP route", async () => {
    const service = new UploadService(
      new InMemoryUploadRepository(),
      () => new Date("2026-07-28T08:00:00.000Z"),
      new InMemoryIdempotencyStore(),
      new InMemoryObjectStorage(),
      new InMemorySourceVersionRepository(),
      undefined,
      1024,
    );

    await expect(
      service.createIntent(
        {
          projectId: crypto.randomUUID(),
          filename: "large.pdf",
          contentType: "application/pdf",
          sizeBytes: 1025,
        },
        "oversized-direct-call",
      ),
    ).rejects.toMatchObject({ code: "UPLOAD_SIZE_MISMATCH" });
  });

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

  it("fails the upload when storage cannot prove the persisted bytes", async () => {
    const uploads = new InMemoryUploadRepository();
    const sourceVersions = new InMemorySourceVersionRepository();
    const storage = new MismatchedObjectStorage();
    const service = new UploadService(
      uploads,
      () => new Date("2026-07-28T08:00:00.000Z"),
      new InMemoryIdempotencyStore(),
      storage,
      sourceVersions,
    );
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const intent = await service.createIntent(
      {
        projectId: crypto.randomUUID(),
        filename: "unproven.png",
        contentType: "image/png",
        sizeBytes: png.byteLength,
      },
      "unproven-upload",
    );

    await expect(service.receive(intent.uploadId, png)).rejects.toMatchObject({
      code: "UPLOAD_STORAGE_MISMATCH",
    });

    await expect(service.find(intent.uploadId)).resolves.toMatchObject({
      status: "failed",
      sha256: null,
    });
    await expect(service.findSourceVersion(intent.uploadId)).resolves.toMatchObject({
      status: "failed",
      sha256: null,
    });
    await expect(storage.inspect(intent.objectKey)).resolves.toBeNull();
  });

  it("reports cleanup failures without replacing the upload integrity error", async () => {
    const uploads = new InMemoryUploadRepository();
    const sourceVersions = new InMemorySourceVersionRepository();
    const storage = new MismatchedCleanupFailingObjectStorage();
    const events: Array<{ stage: string; uploadId: string; objectKey: string }> = [];
    const service = new UploadService(
      uploads,
      () => new Date("2026-07-28T08:00:00.000Z"),
      new InMemoryIdempotencyStore(),
      storage,
      sourceVersions,
      undefined,
      30 * 1024 * 1024,
      undefined,
      undefined,
      (_error, context) => {
        events.push(context);
        throw new Error("observer unavailable");
      },
    );
    const png = onePixelPng();
    const intent = await service.createIntent(
      {
        projectId: crypto.randomUUID(),
        filename: "unproven.png",
        contentType: "image/png",
        sizeBytes: png.byteLength,
      },
      "cleanup-observation",
    );

    await expect(service.receive(intent.uploadId, png)).rejects.toMatchObject({
      code: "UPLOAD_STORAGE_MISMATCH",
    });
    expect(events).toEqual([
      {
        stage: "object_cleanup",
        uploadId: intent.uploadId,
        objectKey: intent.objectKey,
      },
    ]);
    await expect(uploads.findById(intent.uploadId)).resolves.toMatchObject({
      status: "failed",
    });
  });

  it("recovers a committed finalization when its response is lost", async () => {
    const projects = new InMemoryProjectRepository();
    const uploads = new InMemoryUploadRepository();
    const sources = new InMemorySourceVersionRepository();
    const storage = new InMemoryObjectStorage();
    const ownerId = crypto.randomUUID();
    const project = await projects.create(ownerId, {
      name: "Ambiguous commit",
      kind: "image",
    });
    const durable = new InMemoryUploadFinalizationCommand(
      uploads,
      sources,
      projects,
    );
    const lostResponse = {
      finalize: async (input: Parameters<typeof durable.finalize>[0]) => {
        await durable.finalize(input);
        throw new Error("connection lost after commit");
      },
    };
    const service = new UploadService(
      uploads,
      () => new Date("2026-08-03T12:00:00.000Z"),
      new InMemoryIdempotencyStore(),
      storage,
      sources,
      lostResponse,
      30 * 1024 * 1024,
      new InMemoryUploadIntegrityFailureCommand(
        uploads,
        sources,
        projects,
      ),
    );
    const png = onePixelPng();
    const intent = await service.createIntent(
      {
        projectId: project.id,
        filename: "source.png",
        contentType: "image/png",
        sizeBytes: png.byteLength,
      },
      "ambiguous-commit",
    );

    const ready = await service.receive(intent.uploadId, png);

    expect(ready.status).toBe("ready");
    await expect(storage.inspect(intent.objectKey)).resolves.toMatchObject({
      sha256: ready.sha256,
    });
    await expect(projects.findOwnedById(ownerId, project.id)).resolves.toMatchObject({
      status: "queued",
      currentSourceVersionId: ready.sourceVersionId,
    });
  });

  it("makes a missing ready object terminal through the integrity command", async () => {
    const projects = new InMemoryProjectRepository();
    const uploads = new InMemoryUploadRepository();
    const sources = new InMemorySourceVersionRepository();
    const storage = new InMemoryObjectStorage();
    const ownerId = crypto.randomUUID();
    const project = await projects.create(ownerId, {
      name: "Missing source",
      kind: "image",
    });
    const finalization = new InMemoryUploadFinalizationCommand(
      uploads,
      sources,
      projects,
    );
    const service = new UploadService(
      uploads,
      () => new Date("2026-08-03T12:00:00.000Z"),
      new InMemoryIdempotencyStore(),
      storage,
      sources,
      finalization,
      30 * 1024 * 1024,
      new InMemoryUploadIntegrityFailureCommand(
        uploads,
        sources,
        projects,
      ),
    );
    const png = onePixelPng();
    const intent = await service.createIntent(
      {
        projectId: project.id,
        filename: "source.png",
        contentType: "image/png",
        sizeBytes: png.byteLength,
      },
      "missing-ready-source",
    );
    const ready = await service.receive(intent.uploadId, png);
    await storage.delete(ready.objectKey);

    await expect(service.receive(ready.uploadId, png)).rejects.toMatchObject({
      code: "UPLOAD_STORAGE_MISMATCH",
    });
    await expect(uploads.findById(ready.uploadId)).resolves.toMatchObject({
      status: "failed",
    });
    await expect(sources.findById(ready.sourceVersionId!)).resolves.toMatchObject({
      status: "failed",
    });
    await expect(projects.findOwnedById(ownerId, project.id)).resolves.toMatchObject({
      status: "failed",
    });
  });
});

function onePixelPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
}
