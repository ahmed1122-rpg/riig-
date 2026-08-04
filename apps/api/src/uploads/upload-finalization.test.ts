import { describe, expect, it } from "vitest";
import { InMemoryProjectRepository } from "../projects/project-repository.js";
import { InMemorySourceVersionRepository } from "../sources/source-version-repository.js";
import { InMemoryUploadRepository } from "./upload-repository.js";
import { InMemoryUploadFinalizationCommand } from "./upload-finalization.js";

describe("InMemoryUploadFinalizationCommand", () => {
  it("publishes upload, source, and project together without regressing a replay", async () => {
    const projects = new InMemoryProjectRepository();
    const uploads = new InMemoryUploadRepository();
    const sources = new InMemorySourceVersionRepository();
    const ownerId = crypto.randomUUID();
    const project = await projects.create(ownerId, {
      name: "Atomic upload",
      kind: "image",
    });
    const uploadId = crypto.randomUUID();
    const source = await sources.create({
      projectId: project.id,
      uploadId,
      filename: "source.png",
      contentType: "image/png",
      sizeBytes: 1,
    });
    const session = {
      uploadId,
      projectId: project.id,
      filename: "source.png",
      contentType: "image/png" as const,
      expectedSizeBytes: 1,
      status: "uploading" as const,
      sourceVersionId: source.id,
      sha256: null,
      objectKey: `sources/${project.id}/${uploadId}.png`,
      expiresAt: "2026-08-01T12:10:00.000Z",
      maxBytes: 30 * 1024 * 1024,
      uploadUrl: `/v1/uploads/${uploadId}/content`,
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-01T12:00:00.000Z",
    };
    await uploads.save(session);
    const command = new InMemoryUploadFinalizationCommand(
      uploads,
      sources,
      projects,
      () => new Date("2026-08-01T12:01:00.000Z"),
    );
    const sha256 = "a".repeat(64);

    const ready = await command.finalize({ session, sha256 });
    expect(ready).toMatchObject({ status: "ready", sha256 });
    await expect(sources.findById(source.id)).resolves.toMatchObject({
      status: "ready",
      sha256,
    });
    await expect(projects.findOwnedById(ownerId, project.id)).resolves.toMatchObject({
      status: "queued",
      currentSourceVersionId: source.id,
    });

    await projects.updateStatus(project.id, "needs_review");
    await command.finalize({ session: ready, sha256 });
    await expect(projects.findOwnedById(ownerId, project.id)).resolves.toMatchObject({
      status: "needs_review",
      currentSourceVersionId: source.id,
    });

    await expect(
      command.finalize({ session: ready, sha256: "b".repeat(64) }),
    ).rejects.toThrow("Published upload checksum cannot be changed.");
    await expect(uploads.findById(uploadId)).resolves.toMatchObject({
      sha256,
    });
  });
});
