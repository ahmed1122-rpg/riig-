import type { LayerDocument } from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import { createAppTestHarness, registerCreator } from "./app-test-helpers.js";
import { loadConfig } from "./config.js";
import { InMemoryLayerDocumentRepository } from "./processing/processing-repository.js";
import { InMemoryProjectRepository } from "./projects/project-repository.js";

const harness = createAppTestHarness();

describe("project review API", () => {
  it("creates and idempotently replays an exact review approval", async () => {
    const projects = new InMemoryProjectRepository();
    const documents = new InMemoryLayerDocumentRepository();
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }), {
      projects,
      layerDocuments: documents,
    });
    const cookie = await registerCreator(app, "review-owner@example.com");
    const created = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "Review API", kind: "image" },
    });
    const projectId = created.json().data.id as string;
    const sourceVersionId = crypto.randomUUID();
    await projects.updateCurrentSourceVersion(projectId, sourceVersionId, 1);
    await projects.updateStatus(projectId, "needs_review");
    await documents.save(createDocument(projectId, sourceVersionId));
    const request = {
      method: "POST" as const,
      url: `/v1/projects/${projectId}/review/approve`,
      headers: {
        cookie,
        "x-idempotency-key": "review-api-operation-001",
      },
      payload: { sourceVersionId, documentRevision: 5 },
    };

    const approved = await app.inject(request);
    const replayed = await app.inject(request);

    expect(approved.statusCode).toBe(200);
    expect(approved.json().data).toMatchObject({
      id: projectId,
      status: "approved",
      reviewApproval: {
        sourceVersionId,
        documentRevision: 5,
        operationId: "review-api-operation-001",
      },
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json().data.reviewApproval.id).toBe(
      approved.json().data.reviewApproval.id,
    );

    const conflictingReplay = await app.inject({
      ...request,
      payload: { sourceVersionId, documentRevision: 6 },
    });
    expect(conflictingReplay.statusCode).toBe(409);
    expect(conflictingReplay.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("exposes authoritative preflight issues without approving", async () => {
    const projects = new InMemoryProjectRepository();
    const documents = new InMemoryLayerDocumentRepository();
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }), {
      projects,
      layerDocuments: documents,
    });
    const cookie = await registerCreator(app, "invalid-review@example.com");
    const created = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "Invalid review", kind: "image" },
    });
    const projectId = created.json().data.id as string;
    const sourceVersionId = crypto.randomUUID();
    await projects.updateCurrentSourceVersion(projectId, sourceVersionId, 1);
    await projects.updateStatus(projectId, "needs_review");
    const document = createDocument(projectId, sourceVersionId);
    await documents.save({
      ...document,
      layers: document.layers.map((layer) => ({ ...layer, name: "++source" })),
    });

    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/review/approve`,
      headers: {
        cookie,
        "x-idempotency-key": "review-api-invalid-001",
      },
      payload: { sourceVersionId, documentRevision: 5 },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toMatchObject({
      code: "REVIEW_PREFLIGHT_FAILED",
      issues: [{ code: "INVALID_LAYER_PREFIX" }],
    });
    await expect(
      projects.findCurrentReviewApproval(projectId),
    ).resolves.toBeNull();
  });
});

function createDocument(
  projectId: string,
  sourceVersionId: string,
): LayerDocument {
  return {
    schemaVersion: "1.0",
    projectId,
    sourceVersionId,
    revision: 5,
    generatedAt: "2026-08-03T12:00:00.000Z",
    width: 320,
    height: 180,
    colorSpace: "sRGB",
    layers: [
      {
        id: crypto.randomUUID(),
        parentId: null,
        kind: "raster",
        name: "+source",
        visible: true,
        locked: false,
        opacity: 1,
        fixed: false,
        zIndex: 0,
      },
    ],
  };
}
