import { describe, expect, it } from "vitest";
import { InMemoryProjectRepository } from "../projects/project-repository.js";
import { InMemorySourceVersionRepository } from "../sources/source-version-repository.js";
import {
  InMemoryUploadCancellationCommand,
} from "./upload-cancellation.js";
import { InMemoryUploadFinalizationCommand } from "./upload-finalization.js";
import { UploadOperationLock } from "./upload-operation-lock.js";
import { InMemoryUploadRepository } from "./upload-repository.js";

class FailSourceUpdateOnce extends InMemorySourceVersionRepository {
  #remainingFailures = 1;

  override async update(
    ...args: Parameters<InMemorySourceVersionRepository["update"]>
  ) {
    if (this.#remainingFailures > 0) {
      this.#remainingFailures -= 1;
      throw new Error("injected source update failure");
    }
    return super.update(...args);
  }
}

describe("InMemoryUploadCancellationCommand", () => {
  it("converges a partial in-memory transition when cancellation is retried", async () => {
    const projects = new InMemoryProjectRepository();
    const uploads = new InMemoryUploadRepository();
    const sources = new FailSourceUpdateOnce();
    const fixture = await createUploadingFixture(projects, uploads, sources);
    const command = new InMemoryUploadCancellationCommand(
      uploads,
      sources,
      projects,
    );

    await expect(command.cancel({ session: fixture.session })).rejects.toThrow(
      "injected source update failure",
    );
    await expect(uploads.findById(fixture.session.uploadId)).resolves.toMatchObject({
      status: "cancelled",
    });
    await expect(sources.findById(fixture.sourceId)).resolves.toMatchObject({
      status: "uploading",
    });

    await expect(command.cancel({ session: fixture.session })).resolves.toMatchObject({
      outcome: "already_cancelled",
      session: { status: "cancelled" },
    });
    await expect(sources.findById(fixture.sourceId)).resolves.toMatchObject({
      status: "cancelled",
    });
    await expect(projects.findById(fixture.projectId)).resolves.toMatchObject({
      status: "draft",
    });
  });

  it("serializes cancellation against finalization so only one terminal outcome wins", async () => {
    const projects = new InMemoryProjectRepository();
    const uploads = new InMemoryUploadRepository();
    const sources = new InMemorySourceVersionRepository();
    const fixture = await createUploadingFixture(projects, uploads, sources);
    const operations = new UploadOperationLock();
    const cancellation = new InMemoryUploadCancellationCommand(
      uploads,
      sources,
      projects,
      () => new Date("2026-08-03T12:01:00.000Z"),
      operations,
    );
    const finalization = new InMemoryUploadFinalizationCommand(
      uploads,
      sources,
      projects,
      () => new Date("2026-08-03T12:01:00.000Z"),
      operations,
    );

    const [cancelled, finalized] = await Promise.allSettled([
      cancellation.cancel({ session: fixture.session }),
      finalization.finalize({
        session: fixture.session,
        sha256: "a".repeat(64),
      }),
    ]);

    expect(cancelled).toMatchObject({
      status: "fulfilled",
      value: { outcome: "cancelled" },
    });
    expect(finalized).toMatchObject({ status: "rejected" });
    await expect(uploads.findById(fixture.session.uploadId)).resolves.toMatchObject({
      status: "cancelled",
      sha256: null,
    });
    await expect(projects.findById(fixture.projectId)).resolves.toMatchObject({
      status: "draft",
      currentSourceVersionId: null,
    });
  });

  it("restores the exact project state when a replacement upload is cancelled", async () => {
    const projects = new InMemoryProjectRepository();
    const uploads = new InMemoryUploadRepository();
    const sources = new InMemorySourceVersionRepository();
    const operations = new UploadOperationLock();
    const ownerId = crypto.randomUUID();
    const project = await projects.create(ownerId, {
      name: "Replacement",
      kind: "image",
    });
    const original = await createSession(project.id, uploads, sources, 1);
    const ready = await new InMemoryUploadFinalizationCommand(
      uploads,
      sources,
      projects,
      () => new Date("2026-08-03T12:01:00.000Z"),
      operations,
    ).finalize({ session: original.session, sha256: "a".repeat(64) });
    await projects.updateStatus(project.id, "approved");

    const replacement = await createSession(project.id, uploads, sources, 2, {
      projectStatusBeforeUpload: "approved",
    });
    await projects.updateStatus(project.id, "uploading");
    const command = new InMemoryUploadCancellationCommand(
      uploads,
      sources,
      projects,
      () => new Date("2026-08-03T12:03:00.000Z"),
      operations,
    );

    await expect(command.cancel({ session: replacement.session })).resolves.toMatchObject({
      outcome: "cancelled",
    });
    await expect(projects.findById(project.id)).resolves.toMatchObject({
      status: "approved",
      currentSourceVersionId: ready.sourceVersionId,
    });
    await expect(sources.findById(replacement.sourceId)).resolves.toMatchObject({
      status: "cancelled",
    });
  });
});

async function createUploadingFixture(
  projects: InMemoryProjectRepository,
  uploads: InMemoryUploadRepository,
  sources: InMemorySourceVersionRepository,
) {
  const ownerId = crypto.randomUUID();
  const project = await projects.create(ownerId, {
    name: "Cancellation",
    kind: "image",
  });
  const fixture = await createSession(project.id, uploads, sources, 1, {
    projectStatusBeforeUpload: "draft",
  });
  await projects.updateStatus(project.id, "uploading");
  return { ...fixture, projectId: project.id };
}

async function createSession(
  projectId: string,
  uploads: InMemoryUploadRepository,
  sources: InMemorySourceVersionRepository,
  versionNumber: number,
  options: { projectStatusBeforeUpload?: "draft" | "approved" } = {},
) {
  const uploadId = crypto.randomUUID();
  const source = await sources.create({
    projectId,
    uploadId,
    filename: `source-${versionNumber}.png`,
    contentType: "image/png",
    sizeBytes: 1,
  });
  const session = {
    uploadId,
    projectId,
    filename: `source-${versionNumber}.png`,
    contentType: "image/png" as const,
    expectedSizeBytes: 1,
    status: "uploading" as const,
    sourceVersionId: source.id,
    sha256: null,
    objectKey: `sources/${projectId}/${uploadId}.png`,
    expiresAt: "2026-08-03T12:10:00.000Z",
    maxBytes: 30 * 1024 * 1024,
    uploadUrl: `/v1/uploads/${uploadId}/content`,
    createdAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:00:00.000Z",
  };
  await uploads.save(session, options);
  return { session, sourceId: source.id };
}
