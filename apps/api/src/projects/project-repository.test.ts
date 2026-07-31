import { describe, expect, it } from "vitest";
import { InMemoryProjectRepository } from "./project-repository.js";

describe("project job status fencing", () => {
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
});
