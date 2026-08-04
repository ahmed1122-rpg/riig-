import type { LayerDocument } from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryLayerDocumentRepository } from "../processing/processing-repository.js";
import { InMemoryProjectRepository } from "./project-repository.js";
import {
  InMemoryProjectReviewCommand,
  ProjectReviewDomainError,
} from "./project-review.js";

describe("project review approval", () => {
  it("pins approval to the current source and exact document revision", async () => {
    const fixture = await createFixture();

    const result = await fixture.reviews.approve({
      projectId: fixture.projectId,
      sourceVersionId: fixture.sourceVersionId,
      documentRevision: 3,
      actorUserId: fixture.ownerId,
      operationId: "approve-review-operation-1",
    });

    expect(result.replayed).toBe(false);
    expect(result.project).toMatchObject({
      status: "approved",
      reviewApproval: {
        id: result.approval.id,
        sourceVersionId: fixture.sourceVersionId,
        documentRevision: 3,
        actorUserId: fixture.ownerId,
        operationId: "approve-review-operation-1",
      },
    });
    await expect(
      fixture.reviews.findCurrent(fixture.projectId),
    ).resolves.toEqual(result.approval);
  });

  it("replays the same operation but rejects reuse for another revision", async () => {
    const fixture = await createFixture();
    const input = {
      projectId: fixture.projectId,
      sourceVersionId: fixture.sourceVersionId,
      documentRevision: 3,
      actorUserId: fixture.ownerId,
      operationId: "approve-review-operation-2",
    };

    const first = await fixture.reviews.approve(input);
    const replay = await fixture.reviews.approve(input);

    expect(replay).toMatchObject({
      replayed: true,
      approval: { id: first.approval.id },
    });
    await expect(
      fixture.reviews.approve({ ...input, documentRevision: 4 }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("records a distinct approval event for a distinct operation", async () => {
    const fixture = await createFixture();
    const input = {
      projectId: fixture.projectId,
      sourceVersionId: fixture.sourceVersionId,
      documentRevision: 3,
      actorUserId: fixture.ownerId,
    };

    const first = await fixture.reviews.approve({
      ...input,
      operationId: "approve-review-operation-3a",
    });
    const second = await fixture.reviews.approve({
      ...input,
      operationId: "approve-review-operation-3b",
    });

    expect(second.replayed).toBe(false);
    expect(second.approval.id).not.toBe(first.approval.id);
    await expect(
      fixture.reviews.findCurrent(fixture.projectId),
    ).resolves.toEqual(second.approval);
  });

  it("rejects stale revisions before creating an approval", async () => {
    const fixture = await createFixture();

    await expect(
      fixture.reviews.approve({
        projectId: fixture.projectId,
        sourceVersionId: fixture.sourceVersionId,
        documentRevision: 2,
        actorUserId: fixture.ownerId,
        operationId: "approve-stale-revision",
      }),
    ).rejects.toMatchObject({ code: "REVIEW_REVISION_CONFLICT" });
    await expect(
      fixture.reviews.findCurrent(fixture.projectId),
    ).resolves.toBeNull();
  });

  it("returns structured preflight issues for an invalid document", async () => {
    const fixture = await createFixture({ validLayerName: false });

    await expect(
      fixture.reviews.approve({
        projectId: fixture.projectId,
        sourceVersionId: fixture.sourceVersionId,
        documentRevision: 3,
        actorUserId: fixture.ownerId,
        operationId: "approve-invalid-document",
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ProjectReviewDomainError &&
        error.code === "REVIEW_PREFLIGHT_FAILED" &&
        error.issues.some((issue) => issue.code === "INVALID_LAYER_PREFIX"),
    );
  });

  it("invalidates approval after document mutation or source replacement", async () => {
    const fixture = await createFixture();
    await fixture.reviews.approve({
      projectId: fixture.projectId,
      sourceVersionId: fixture.sourceVersionId,
      documentRevision: 3,
      actorUserId: fixture.ownerId,
      operationId: "approve-before-mutation",
    });

    const invalidated = await fixture.projects.invalidateReview(
      fixture.projectId,
      fixture.sourceVersionId,
    );
    expect(invalidated).toMatchObject({
      status: "needs_review",
      reviewApproval: null,
    });

    await fixture.reviews.approve({
      projectId: fixture.projectId,
      sourceVersionId: fixture.sourceVersionId,
      documentRevision: 3,
      actorUserId: fixture.ownerId,
      operationId: "approve-before-source-change",
    });
    const nextSourceVersionId = crypto.randomUUID();
    const replaced = await fixture.projects.updateCurrentSourceVersion(
      fixture.projectId,
      nextSourceVersionId,
      2,
    );
    expect(replaced).toMatchObject({
      currentSourceVersionId: nextSourceVersionId,
      reviewApproval: null,
    });
  });

  it("does not mark a changed document completed when an older export finishes", async () => {
    const fixture = await createFixture();
    await fixture.reviews.approve({
      projectId: fixture.projectId,
      sourceVersionId: fixture.sourceVersionId,
      documentRevision: 3,
      actorUserId: fixture.ownerId,
      operationId: "approve-before-concurrent-export",
    });
    const exportJob = { type: "export" as const, id: crypto.randomUUID() };
    await fixture.projects.updateStatusForSource(
      fixture.projectId,
      fixture.sourceVersionId,
      "exporting",
      exportJob,
    );

    const invalidated = await fixture.projects.invalidateReview(
      fixture.projectId,
      fixture.sourceVersionId,
    );
    const finished = await fixture.projects.finishJobStatus(
      fixture.projectId,
      fixture.sourceVersionId,
      exportJob,
      "completed",
    );

    expect(invalidated).toMatchObject({
      status: "exporting",
      reviewApproval: null,
    });
    expect(finished).toMatchObject({
      status: "needs_review",
      reviewApproval: null,
    });
  });

  it.each(["failed", "cancelled"] as const)(
    "keeps the matching review approval after an export is %s",
    async (outcome) => {
      const fixture = await createFixture();
      const approved = await fixture.reviews.approve({
        projectId: fixture.projectId,
        sourceVersionId: fixture.sourceVersionId,
        documentRevision: 3,
        actorUserId: fixture.ownerId,
        operationId: `approve-before-${outcome}-export`,
      });
      const exportJob = { type: "export" as const, id: crypto.randomUUID() };
      await fixture.projects.updateStatusForSource(
        fixture.projectId,
        fixture.sourceVersionId,
        "exporting",
        exportJob,
      );

      const settled = await fixture.projects.finishJobStatus(
        fixture.projectId,
        fixture.sourceVersionId,
        exportJob,
        outcome,
        3,
      );

      expect(settled).toMatchObject({
        status: "approved",
        reviewApproval: { id: approved.approval.id, documentRevision: 3 },
      });
    },
  );
});

async function createFixture(options: { validLayerName?: boolean } = {}) {
  const projects = new InMemoryProjectRepository();
  const documents = new InMemoryLayerDocumentRepository();
  const ownerId = crypto.randomUUID();
  const sourceVersionId = crypto.randomUUID();
  const project = await projects.create(ownerId, {
    name: "Review lifecycle",
    kind: "image",
  });
  await projects.updateCurrentSourceVersion(project.id, sourceVersionId, 1);
  await projects.updateStatus(project.id, "needs_review");
  await documents.save(
    createDocument(
      project.id,
      sourceVersionId,
      options.validLayerName !== false,
    ),
  );
  return {
    projects,
    reviews: new InMemoryProjectReviewCommand(
      projects,
      documents,
      () => new Date("2026-08-03T12:00:00.000Z"),
    ),
    ownerId,
    sourceVersionId,
    projectId: project.id,
  };
}

function createDocument(
  projectId: string,
  sourceVersionId: string,
  validLayerName: boolean,
): LayerDocument {
  return {
    schemaVersion: "1.0",
    projectId,
    sourceVersionId,
    revision: 3,
    generatedAt: "2026-08-03T11:00:00.000Z",
    width: 640,
    height: 360,
    colorSpace: "sRGB",
    layers: [
      {
        id: crypto.randomUUID(),
        parentId: null,
        kind: "raster",
        name: validLayerName ? "+source" : "++source",
        visible: true,
        locked: false,
        opacity: 1,
        fixed: false,
        zIndex: 0,
      },
    ],
  };
}
