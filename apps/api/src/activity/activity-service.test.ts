import type { ExportJob, ProcessingJob } from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryExportRepository } from "../exports/export-repository.js";
import { InMemoryProcessingJobRepository } from "../processing/processing-repository.js";
import { InMemoryProjectRepository } from "../projects/project-repository.js";
import { ActivityService } from "./activity-service.js";

describe("ActivityService", () => {
  it("returns an owned, stable, cursor-paginated workflow feed", async () => {
    const projects = new InMemoryProjectRepository();
    const processing = new InMemoryProcessingJobRepository();
    const exports = new InMemoryExportRepository();
    const ownedProject = await projects.create("owner", {
      name: "Owned project",
      kind: "image",
    });
    const foreignProject = await projects.create("other", {
      name: "Foreign project",
      kind: "book",
    });
    const projectCreatedAt = Date.parse(ownedProject.updatedAt);
    await processing.save(
      processingJob(
        ownedProject.id,
        new Date(projectCreatedAt + 60 * 60_000).toISOString(),
      ),
    );
    await exports.save(
      exportJob(
        ownedProject.id,
        new Date(projectCreatedAt + 2 * 60 * 60_000).toISOString(),
      ),
    );
    await exports.save(
      exportJob(
        foreignProject.id,
        new Date(projectCreatedAt + 3 * 60 * 60_000).toISOString(),
      ),
    );
    const service = new ActivityService(
      projects,
      processing,
      exports,
      () => new Date("2026-08-04T13:00:00.000Z"),
    );

    const first = await service.listOwnedByUser("owner", { limit: 2 });
    const second = await service.listOwnedByUser("owner", {
      limit: 2,
      cursor: first.nextCursor!,
    });

    expect(first.items.map((item) => item.kind)).toEqual([
      "export",
      "processing",
    ]);
    expect(first.items.every((item) => item.project.id === ownedProject.id)).toBe(
      true,
    );
    expect(first.nextCursor).toBeTypeOf("string");
    expect(second.items).toHaveLength(1);
    expect(second.items[0]).toMatchObject({
      kind: "upload",
      status: "pending",
      project: { id: ownedProject.id },
    });
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size)
      .toBe(3);
    expect(first.generatedAt).toBe("2026-08-04T13:00:00.000Z");
  });

  it("rejects malformed cursors explicitly", async () => {
    const service = new ActivityService(
      new InMemoryProjectRepository(),
      new InMemoryProcessingJobRepository(),
      new InMemoryExportRepository(),
    );

    await expect(
      service.listOwnedByUser("owner", { cursor: "not-a-cursor" }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "ACTIVITY_CURSOR_INVALID",
      }),
    );
  });

  it("does not skip another activity kind with the same update timestamp", async () => {
    const projects = new InMemoryProjectRepository();
    const processing = new InMemoryProcessingJobRepository();
    const exports = new InMemoryExportRepository();
    const project = await projects.create("owner", {
      name: "Concurrent updates",
      kind: "image",
    });
    await projects.updateStatus(project.id, "queued");
    const timestamp = "2026-08-04T11:00:00.000Z";
    await processing.save(
      processingJob(
        project.id,
        timestamp,
        "00000000-0000-4000-8000-000000000002",
      ),
    );
    await exports.save(
      exportJob(
        project.id,
        timestamp,
        "00000000-0000-4000-8000-000000000001",
      ),
    );
    const service = new ActivityService(projects, processing, exports);

    const first = await service.listOwnedByUser("owner", { limit: 1 });
    const second = await service.listOwnedByUser("owner", {
      limit: 1,
      cursor: first.nextCursor!,
    });

    expect(first.items[0]?.id).toBe(
      "processing:00000000-0000-4000-8000-000000000002",
    );
    expect(second.items[0]?.id).toBe(
      "export:00000000-0000-4000-8000-000000000001",
    );
  });
});

function processingJob(
  projectId: string,
  updatedAt: string,
  id = crypto.randomUUID(),
): ProcessingJob {
  return {
    id,
    projectId,
    sourceVersionId: crypto.randomUUID(),
    projectKind: "image",
    options: {},
    status: "processing",
    progress: 45,
    attempt: 1,
    maxAttempts: 3,
    nextAttemptAt: updatedAt,
    leaseOwner: "worker",
    leaseExpiresAt: "2026-08-04T10:05:00.000Z",
    errorCode: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

function exportJob(
  projectId: string,
  updatedAt: string,
  id = crypto.randomUUID(),
): ExportJob {
  return {
    id,
    projectId,
    sourceVersionId: crypto.randomUUID(),
    documentRevision: 1,
    projectKind: "image",
    format: "psd",
    scope: "full-document",
    scale: 1,
    colorProfile: "sRGB",
    namingPresetId: "default",
    status: "failed",
    progress: 70,
    attempt: 3,
    maxAttempts: 3,
    nextAttemptAt: updatedAt,
    leaseOwner: null,
    leaseExpiresAt: null,
    errorCode: "EXPORT_WORKER_FAILED",
    createdAt: updatedAt,
    updatedAt,
  };
}
