import { describe, expect, it } from "vitest";
import { InMemoryProjectRepository } from "./project-repository.js";

describe("project job status fencing", () => {
  it("deletes only an empty draft owned by the requesting user", async () => {
    const projects = new InMemoryProjectRepository();
    const ownerId = crypto.randomUUID();
    const project = await projects.create(ownerId, {
      name: "مسودة فارغة",
      kind: "image",
    });

    await expect(
      projects.deleteEmptyDraft(crypto.randomUUID(), project.id),
    ).resolves.toBe(false);
    await expect(
      projects.deleteEmptyDraft(ownerId, project.id),
    ).resolves.toBe(true);
    await expect(projects.findById(project.id)).resolves.toBeNull();

    const started = await projects.create(ownerId, {
      name: "بدأ الرفع",
      kind: "image",
    });
    await projects.updateStatus(started.id, "uploading");
    await expect(
      projects.deleteEmptyDraft(ownerId, started.id),
    ).resolves.toBe(false);
  });

  it("accepts only the active job for the current source", async () => {
    const projects = new InMemoryProjectRepository();
    const ownerId = crypto.randomUUID();
    const sourceVersionId = crypto.randomUUID();
    const project = await projects.create(ownerId, {
      name: "مشروع محمي من النتائج القديمة",
      kind: "image",
    });
    await projects.updateCurrentSourceVersion(
      project.id,
      sourceVersionId,
      1,
    );
    await projects.updateStatusForSource(
      project.id,
      sourceVersionId,
      "processing",
      { type: "processing", id: "00000000-0000-4000-8000-000000000001" },
    );

    const stale = await projects.finishJobStatus(
      project.id,
      sourceVersionId,
      { type: "processing", id: "00000000-0000-4000-8000-000000000002" },
      "failed",
    );
    const afterStale = await projects.findOwnedById(ownerId, project.id);
    const current = await projects.finishJobStatus(
      project.id,
      sourceVersionId,
      { type: "processing", id: "00000000-0000-4000-8000-000000000001" },
      "needs_review",
    );

    expect(stale).toBeNull();
    expect(afterStale?.status).toBe("processing");
    expect(current?.status).toBe("needs_review");
  });

  it("ignores a job after a newer source version supersedes it", async () => {
    const projects = new InMemoryProjectRepository();
    const ownerId = crypto.randomUUID();
    const firstSource = crypto.randomUUID();
    const secondSource = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const project = await projects.create(ownerId, {
      name: "مصدر أحدث",
      kind: "book",
    });
    await projects.updateCurrentSourceVersion(project.id, firstSource, 1);
    await projects.updateStatusForSource(
      project.id,
      firstSource,
      "processing",
      { type: "processing", id: jobId },
    );
    await projects.updateCurrentSourceVersion(project.id, secondSource, 2);
    await projects.updateStatus(project.id, "queued");

    const stale = await projects.finishJobStatus(
      project.id,
      firstSource,
      { type: "processing", id: jobId },
      "failed",
    );

    expect(stale).toBeNull();
    await expect(projects.findOwnedById(ownerId, project.id)).resolves.toMatchObject({
      currentSourceVersionId: secondSource,
      status: "queued",
    });
  });

  it("does not let a second job replace the active project reservation", async () => {
    const projects = new InMemoryProjectRepository();
    const ownerId = crypto.randomUUID();
    const sourceVersionId = crypto.randomUUID();
    const firstJobId = crypto.randomUUID();
    const project = await projects.create(ownerId, {
      name: "حجز مهمة واحد",
      kind: "image",
    });
    await projects.updateCurrentSourceVersion(project.id, sourceVersionId, 1);
    await projects.updateStatusForSource(
      project.id,
      sourceVersionId,
      "processing",
      { type: "processing", id: firstJobId },
    );

    const competing = await projects.updateStatusForSource(
      project.id,
      sourceVersionId,
      "exporting",
      { type: "export", id: crypto.randomUUID() },
    );
    const completed = await projects.finishJobStatus(
      project.id,
      sourceVersionId,
      { type: "processing", id: firstJobId },
      "needs_review",
    );

    expect(competing).toBeNull();
    expect(completed?.status).toBe("needs_review");
  });

  it("does not let a late upload status transition clear an active job fence", async () => {
    const projects = new InMemoryProjectRepository();
    const sourceVersionId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const project = await projects.create(crypto.randomUUID(), {
      name: "سباق رفع ومعالجة",
      kind: "book",
    });
    await projects.updateCurrentSourceVersion(project.id, sourceVersionId, 1);
    await projects.updateStatusForSource(
      project.id,
      sourceVersionId,
      "processing",
      { type: "processing", id: jobId },
    );

    await expect(
      projects.updateStatus(project.id, "uploading"),
    ).resolves.toBeNull();
    await expect(projects.findById(project.id)).resolves.toMatchObject({
      status: "processing",
    });
    await expect(projects.hasActiveJob(project.id)).resolves.toBe(true);
  });

  it("keeps the active source and fence when an idle-only restore races a job", async () => {
    for (let iteration = 0; iteration < 50; iteration += 1) {
      const projects = new InMemoryProjectRepository();
      const ownerId = crypto.randomUUID();
      const firstSource = crypto.randomUUID();
      const secondSource = crypto.randomUUID();
      const jobId = crypto.randomUUID();
      const project = await projects.create(ownerId, {
        name: `restore-race-${iteration}`,
        kind: "image",
      });
      await projects.updateCurrentSourceVersion(project.id, firstSource, 1);
      await projects.updateStatusForSource(
        project.id,
        firstSource,
        "processing",
        { type: "processing", id: jobId },
      );

      await expect(
        projects.updateCurrentSourceVersion(
          project.id,
          secondSource,
          2,
          true,
        ),
      ).resolves.toBeNull();
      await expect(projects.findById(project.id)).resolves.toMatchObject({
        currentSourceVersionId: firstSource,
        status: "processing",
      });
      await expect(projects.hasActiveJob(project.id)).resolves.toBe(true);
    }
  });
});
