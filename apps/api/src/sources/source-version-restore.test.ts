import { describe, expect, it } from "vitest";
import { InMemoryProjectRepository } from "../projects/project-repository.js";
import {
  InMemorySourceVersionRepository,
} from "./source-version-repository.js";
import { InMemorySourceVersionRestoreCommand } from "./source-version-restore.js";

describe("source version restore fencing", () => {
  it("rejects an active job without changing the source or writing an event", async () => {
    for (let iteration = 0; iteration < 50; iteration += 1) {
      const fixture = await createFixture();
      await fixture.projects.updateStatusForSource(
        fixture.project.id,
        fixture.second.id,
        "processing",
        { type: "processing", id: crypto.randomUUID() },
      );

      await expect(
        fixture.command.restore({
          ...fixture.input,
          idempotencyKey: `busy-restore-${iteration}`,
        }),
      ).rejects.toMatchObject({ code: "SOURCE_VERSION_BUSY" });
      await expect(fixture.projects.findById(fixture.project.id)).resolves.toMatchObject({
        currentSourceVersionId: fixture.second.id,
        status: "processing",
      });
      await expect(
        fixture.command.list(fixture.project.id, fixture.ownerId),
      ).resolves.toEqual([]);
    }
  });

  it("replays a committed restore even if a later job is active", async () => {
    const fixture = await createFixture();
    const restored = await fixture.command.restore(fixture.input);
    await fixture.projects.updateStatusForSource(
      fixture.project.id,
      fixture.first.id,
      "processing",
      { type: "processing", id: crypto.randomUUID() },
    );

    await expect(fixture.command.restore(fixture.input)).resolves.toMatchObject({
      replayed: true,
      event: { id: restored.event.id },
    });
  });
});

async function createFixture() {
  const ownerId = crypto.randomUUID();
  const projects = new InMemoryProjectRepository();
  const versions = new InMemorySourceVersionRepository();
  const project = await projects.create(ownerId, {
    name: "restore-fence",
    kind: "image",
  });
  const first = await versions.create({
    projectId: project.id,
    uploadId: crypto.randomUUID(),
    filename: "first.png",
    contentType: "image/png",
    sizeBytes: 1,
  });
  const second = await versions.create({
    projectId: project.id,
    uploadId: crypto.randomUUID(),
    filename: "second.png",
    contentType: "image/png",
    sizeBytes: 1,
  });
  await versions.update(first.id, { status: "ready", sha256: "a".repeat(64) });
  await versions.update(second.id, { status: "ready", sha256: "b".repeat(64) });
  await projects.updateCurrentSourceVersion(project.id, second.id, 2);
  const command = new InMemorySourceVersionRestoreCommand(projects, versions);
  return {
    ownerId,
    projects,
    project,
    first,
    second,
    command,
    input: {
      projectId: project.id,
      actorUserId: ownerId,
      targetSourceVersionId: first.id,
      expectedCurrentSourceVersionId: second.id,
      reason: "Restore the reviewed source.",
      idempotencyKey: "restore-fence-idempotency",
      originatingRequestId: crypto.randomUUID(),
    },
  };
}
