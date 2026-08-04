import { describe, expect, it } from "vitest";
import { InMemoryProjectRepository } from "../projects/project-repository.js";
import { InMemorySourceVersionRepository } from "../sources/source-version-repository.js";
import { InMemoryUploadFinalizationCommand } from "./upload-finalization.js";
import { InMemoryUploadIntegrityFailureCommand } from "./upload-integrity-failure.js";
import { InMemoryUploadRepository } from "./upload-repository.js";

describe("InMemoryUploadIntegrityFailureCommand", () => {
  it("fails the upload, current source, and project once", async () => {
    const fixture = await createReadyFixture();
    const command = new InMemoryUploadIntegrityFailureCommand(
      fixture.uploads,
      fixture.sources,
      fixture.projects,
      () => new Date("2026-08-03T12:05:00.000Z"),
    );

    const outcomes = await Promise.all([
      command.markIntegrityFailure({
        session: fixture.ready,
        code: "UPLOAD_OBJECT_MISSING",
        observed: null,
      }),
      command.markIntegrityFailure({
        session: fixture.ready,
        code: "UPLOAD_OBJECT_MISSING",
        observed: null,
      }),
    ]);

    expect(outcomes).toEqual(
      expect.arrayContaining([
        { outcome: "transitioned" },
        { outcome: "already_terminal" },
      ]),
    );
    await expect(fixture.uploads.findById(fixture.ready.uploadId)).resolves.toMatchObject({
      status: "failed",
    });
    await expect(fixture.sources.findById(fixture.sourceId)).resolves.toMatchObject({
      status: "failed",
    });
    await expect(
      fixture.projects.findOwnedById(fixture.ownerId, fixture.projectId),
    ).resolves.toMatchObject({ status: "failed" });
  });

  it("does not apply a stale observation after the upload advances", async () => {
    const fixture = await createReadyFixture();
    const command = new InMemoryUploadIntegrityFailureCommand(
      fixture.uploads,
      fixture.sources,
      fixture.projects,
    );
    const stale = { ...fixture.ready, status: "verifying" as const, sha256: null };

    await expect(
      command.markIntegrityFailure({
        session: stale,
        code: "UPLOAD_HASH_MISMATCH",
        observed: null,
      }),
    ).resolves.toEqual({ outcome: "stale_candidate" });
    await expect(fixture.uploads.findById(fixture.ready.uploadId)).resolves.toMatchObject({
      status: "ready",
    });
  });
});

async function createReadyFixture() {
  const projects = new InMemoryProjectRepository();
  const uploads = new InMemoryUploadRepository();
  const sources = new InMemorySourceVersionRepository();
  const ownerId = crypto.randomUUID();
  const project = await projects.create(ownerId, {
    name: "Integrity fixture",
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
    status: "verifying" as const,
    sourceVersionId: source.id,
    sha256: null,
    objectKey: `sources/${project.id}/${uploadId}.png`,
    expiresAt: "2026-08-03T12:10:00.000Z",
    maxBytes: 30 * 1024 * 1024,
    uploadUrl: `/v1/uploads/${uploadId}/content`,
    createdAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:00:00.000Z",
  };
  await uploads.save(session);
  const ready = await new InMemoryUploadFinalizationCommand(
    uploads,
    sources,
    projects,
  ).finalize({ session, sha256: "a".repeat(64) });
  return {
    projects,
    uploads,
    sources,
    ownerId,
    projectId: project.id,
    sourceId: source.id,
    ready,
  };
}
