import type { ExportJob, ProcessingJob } from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryExportRepository } from "../exports/export-repository.js";
import { InMemoryProcessingJobRepository } from "../processing/processing-repository.js";

describe("job enqueue atomicity", () => {
  it("does not expose a processing job while fence activation is pending", async () => {
    const repository = new InMemoryProcessingJobRepository();
    const job = processingJob();
    let release!: (activated: boolean) => void;
    const activation = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const enqueue = repository.enqueue(job, () => activation);

    await expect(repository.findById(job.id)).resolves.toBeNull();
    release(true);
    await expect(enqueue).resolves.toBe(true);
    await expect(repository.findById(job.id)).resolves.toEqual(job);
  });

  it("rolls back a duplicate processing job id without replacing the original", async () => {
    const repository = new InMemoryProcessingJobRepository();
    const original = processingJob();
    const collision = { ...processingJob(), id: original.id };
    await repository.enqueue(original);

    await expect(repository.enqueue(collision)).resolves.toBe(false);
    await expect(repository.findById(original.id)).resolves.toEqual(original);
  });

  it("does not retain a processing job when the project fence loses its race", async () => {
    for (let iteration = 0; iteration < 50; iteration += 1) {
      const repository = new InMemoryProcessingJobRepository();
      const job = processingJob();

      await expect(repository.enqueue(job, async () => false)).resolves.toBe(false);
      await expect(repository.findById(job.id)).resolves.toBeNull();
    }
  });

  it("does not retain an export job when the project fence loses its race", async () => {
    for (let iteration = 0; iteration < 50; iteration += 1) {
      const repository = new InMemoryExportRepository();
      const job = exportJob();

      await expect(repository.enqueue(job, async () => false)).resolves.toBe(false);
      await expect(repository.findById(job.id)).resolves.toBeNull();
    }
  });
});

function processingJob(): ProcessingJob {
  const now = "2026-08-13T00:00:00.000Z";
  return {
    id: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    sourceVersionId: crypto.randomUUID(),
    projectKind: "image",
    options: {},
    status: "queued",
    progress: 0,
    attempt: 0,
    maxAttempts: 3,
    nextAttemptAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
    errorCode: null,
    createdAt: now,
    updatedAt: now,
  };
}

function exportJob(): ExportJob {
  const now = "2026-08-13T00:00:00.000Z";
  return {
    id: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    sourceVersionId: crypto.randomUUID(),
    documentRevision: 1,
    projectKind: "image",
    format: "psd",
    scope: "full-document",
    scale: 1,
    colorProfile: "sRGB",
    namingPresetId: "adobe-default",
    status: "queued",
    progress: 0,
    attempt: 0,
    maxAttempts: 3,
    nextAttemptAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
    errorCode: null,
    createdAt: now,
    updatedAt: now,
  };
}
