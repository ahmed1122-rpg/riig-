import { describe, expect, it } from "vitest";
import { InMemoryIdempotencyStore } from "../idempotency/idempotency-store.js";
import { InMemoryObjectStorage } from "../storage/object-storage.js";
import { InMemoryUploadRepository } from "../uploads/upload-repository.js";
import {
  InMemoryLayerDocumentRepository,
  InMemoryProcessingJobRepository,
} from "./processing-repository.js";
import { ProcessingService } from "./processing-service.js";

describe("ProcessingService request validation", () => {
  it("rejects a ready source from another project before saving a job", async () => {
    const jobs = new InMemoryProcessingJobRepository();
    const uploads = new InMemoryUploadRepository();
    const sourceVersionId = crypto.randomUUID();
    await uploads.save({
      uploadId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      filename: "other.png",
      contentType: "image/png",
      expectedSizeBytes: 1,
      status: "ready",
      sourceVersionId,
      sha256: "a".repeat(64),
      objectKey: "sources/other/source.png",
      expiresAt: "2026-08-01T00:00:00.000Z",
      maxBytes: 30 * 1024 * 1024,
      uploadUrl: "/unused",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
    });
    const service = new ProcessingService(
      jobs,
      new InMemoryLayerDocumentRepository(),
      uploads,
      new InMemoryObjectStorage(),
    );

    await expect(
      service.createAndRun(
        crypto.randomUUID(),
        sourceVersionId,
        "image",
        {},
        "cross-project-source",
      ),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_READY" });
    await expect(jobs.list(10)).resolves.toEqual([]);
  });

  it("rejects a source that has not reached ready state", async () => {
    const jobs = new InMemoryProcessingJobRepository();
    const uploads = new InMemoryUploadRepository();
    const projectId = crypto.randomUUID();
    const sourceVersionId = crypto.randomUUID();
    await uploads.save({
      uploadId: crypto.randomUUID(),
      projectId,
      filename: "pending.pdf",
      contentType: "application/pdf",
      expectedSizeBytes: 1,
      status: "verifying",
      sourceVersionId,
      sha256: null,
      objectKey: "sources/pending/source.pdf",
      expiresAt: "2026-08-01T00:00:00.000Z",
      maxBytes: 30 * 1024 * 1024,
      uploadUrl: "/unused",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
    });
    const service = new ProcessingService(
      jobs,
      new InMemoryLayerDocumentRepository(),
      uploads,
      new InMemoryObjectStorage(),
    );

    await expect(
      service.createAndRun(
        projectId,
        sourceVersionId,
        "book",
        {},
        "pending-source",
      ),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_READY" });
    await expect(jobs.list(10)).resolves.toEqual([]);
  });

  it("replays an identical request and rejects reuse for different options", async () => {
    const jobs = new InMemoryProcessingJobRepository();
    const uploads = new InMemoryUploadRepository();
    const projectId = crypto.randomUUID();
    const sourceVersionId = crypto.randomUUID();
    await uploads.save({
      uploadId: crypto.randomUUID(),
      projectId,
      filename: "ready.pdf",
      contentType: "application/pdf",
      expectedSizeBytes: 1,
      status: "ready",
      sourceVersionId,
      sha256: "a".repeat(64),
      objectKey: "sources/ready/source.pdf",
      expiresAt: "2026-08-01T00:00:00.000Z",
      maxBytes: 30 * 1024 * 1024,
      uploadUrl: "/unused",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
    });
    const service = new ProcessingService(
      jobs,
      new InMemoryLayerDocumentRepository(),
      uploads,
      new InMemoryObjectStorage(),
      () => new Date("2026-07-31T00:00:00.000Z"),
      new InMemoryIdempotencyStore(),
      false,
    );

    const first = await service.createAndRun(
      projectId,
      sourceVersionId,
      "book",
      { pdfSeparationMode: "word" },
      "same-processing-request",
    );
    const replayed = await service.createAndRun(
      projectId,
      sourceVersionId,
      "book",
      { pdfSeparationMode: "word" },
      "same-processing-request",
    );

    expect(replayed.id).toBe(first.id);
    await expect(
      service.createAndRun(
        projectId,
        sourceVersionId,
        "book",
        { pdfSeparationMode: "line" },
        "same-processing-request",
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(jobs.list(10)).resolves.toHaveLength(1);
  });
});
