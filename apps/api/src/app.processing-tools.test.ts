import { describe, expect, it } from "vitest";
import {
  MAX_LAYER_TEXT_CHARACTERS,
  type LayerDocument,
} from "@motionprep/contracts";
import { loadConfig } from "./config.js";
import {
  createAppTestHarness,
  registerCreator,
} from "./app-test-helpers.js";
import { InMemoryLayerDocumentRepository } from "./processing/processing-repository.js";
import { InMemoryProjectRepository } from "./projects/project-repository.js";

const harness = createAppTestHarness();
const sourceVersionId = "00000000-0000-4000-8000-000000000202";

describe("API — عمليات وحدات PDF النصية", () => {
  it("splits, replays, undoes, and redoes an owned document", async () => {
    const documents = new InMemoryLayerDocumentRepository();
    const projects = new InMemoryProjectRepository();
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }), {
      layerDocuments: documents,
      projects,
    });
    const cookie = await registerCreator(app, "pdf-tools@example.com");
    const project = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "تحرير PDF", kind: "book" },
    });
    const projectId = project.json().data.id as string;
    await projects.updateCurrentSourceVersion(projectId, sourceVersionId, 1);
    await documents.save(createDocument(projectId));
    const splitRequest = {
      method: "POST" as const,
      url: `/v1/projects/${projectId}/layer-document/text/split`,
      headers: {
        cookie,
        "x-idempotency-key": "api-split-operation-001",
      },
      payload: {
        sourceVersionId,
        baseRevision: 1,
        layerId: "text-a",
        offset: 5,
      },
    };

    const split = await app.inject(splitRequest);
    const replay = await app.inject(splitRequest);
    const undo = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/layer-document/history`,
      headers: { cookie },
      payload: {
        sourceVersionId,
        baseRevision: 2,
        direction: "undo",
      },
    });
    const redo = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/layer-document/history`,
      headers: { cookie },
      payload: {
        sourceVersionId,
        baseRevision: 3,
        direction: "redo",
      },
    });

    expect(split.statusCode).toBe(200);
    expect(split.json().data.document.revision).toBe(2);
    expect(split.json().data.createdLayerIds).toHaveLength(1);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.createdLayerIds).toEqual(
      split.json().data.createdLayerIds,
    );
    expect(undo.statusCode).toBe(200);
    expect(undo.json().data.revision).toBe(3);
    expect(undo.json().data.layers).toHaveLength(4);
    expect(redo.statusCode).toBe(200);
    expect(redo.json().data.revision).toBe(4);
    expect(redo.json().data.layers).toHaveLength(5);
  });

  it("does not expose another user's document operations", async () => {
    const documents = new InMemoryLayerDocumentRepository();
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }), {
      layerDocuments: documents,
    });
    const ownerCookie = await registerCreator(app, "owner-tools@example.com");
    const outsiderCookie = await registerCreator(
      app,
      "outsider-tools@example.com",
    );
    const project = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie: ownerCookie },
      payload: { name: "مستند خاص", kind: "book" },
    });
    const projectId = project.json().data.id as string;
    await documents.save(createDocument(projectId));

    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/layer-document/text/merge`,
      headers: {
        cookie: outsiderCookie,
        "x-idempotency-key": "outsider-merge-operation-001",
      },
      payload: {
        sourceVersionId,
        baseRevision: 1,
        layerIds: ["text-a", "text-b"],
        separator: "space",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("PROJECT_NOT_FOUND");
  });

  it("applies and replays a multi-layer command as one revision", async () => {
    const documents = new InMemoryLayerDocumentRepository();
    const projects = new InMemoryProjectRepository();
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }), {
      layerDocuments: documents,
      projects,
    });
    const cookie = await registerCreator(app, "layer-command@example.com");
    const project = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "أوامر الطبقات", kind: "book" },
    });
    const projectId = project.json().data.id as string;
    await projects.updateCurrentSourceVersion(projectId, sourceVersionId, 1);
    await documents.save(createDocument(projectId));
    const request = {
      method: "POST" as const,
      url: `/v1/projects/${projectId}/layer-document/commands`,
      headers: { cookie, "x-idempotency-key": "layer-command-001" },
      payload: {
        sourceVersionId,
        baseRevision: 1,
        command: {
          kind: "update-state",
          scope: { kind: "layers", layerIds: ["text-a", "text-b"] },
          visible: false,
        },
      },
    };
    const updated = await app.inject(request);
    const replay = await app.inject(request);
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.revision).toBe(2);
    expect(updated.json().data.layers.filter(
      (layer: { kind: string }) => layer.kind === "text",
    ).every((layer: { visible: boolean }) => !layer.visible)).toBe(true);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.revision).toBe(2);
  });

  it("persists manual PDF text and layout metadata through the HTTP contract", async () => {
    const documents = new InMemoryLayerDocumentRepository();
    const projects = new InMemoryProjectRepository();
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }), {
      layerDocuments: documents,
      projects,
    });
    const cookie = await registerCreator(app, "text-edit@example.com");
    const project = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "تحرير النص", kind: "book" },
    });
    const projectId = project.json().data.id as string;
    await projects.updateCurrentSourceVersion(projectId, sourceVersionId, 1);
    await documents.save(createDocument(projectId));

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/layer-document`,
      headers: {
        cookie,
        "x-idempotency-key": "manual-text-layout-edit-001",
      },
      payload: {
        sourceVersionId,
        baseRevision: 1,
        layers: [
          {
            id: "text-a",
            name: "+مرحبا_المصححة",
            visible: true,
            locked: false,
            opacity: 0.8,
            zIndex: 2,
            readingOrder: 1,
            bounds: { x: 450, y: 120, width: 420, height: 80 },
            direction: "ltr",
            textAlign: "center",
            fontFamily: "Inter",
            fontSize: 24,
            fullText: "  نص مصحح عبر الواجهة  ",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(
      response.json().data.layers.find(
        (layer: { id: string }) => layer.id === "text-a",
      ),
    ).toMatchObject({
      name: "+مرحبا_المصححة",
      opacity: 0.8,
      zIndex: 2,
      readingOrder: 1,
      bounds: { x: 450, y: 120, width: 420, height: 80 },
      direction: "ltr",
      textAlign: "center",
      fontFamily: "Inter",
      fontSize: 24,
      fullText: "نص مصحح عبر الواجهة",
    });
    expect(
      (await documents.findBySource(projectId, sourceVersionId))?.layers.find(
        (layer) => layer.id === "text-a",
      ),
    ).toMatchObject({
      fullText: "نص مصحح عبر الواجهة",
      fontSize: 24,
      textAlign: "center",
    });

    const oversized = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/layer-document`,
      headers: {
        cookie,
        "x-idempotency-key": "oversized-text-layout-edit-001",
      },
      payload: {
        sourceVersionId,
        baseRevision: 2,
        layers: [
          {
            id: "text-a",
            name: "+مرحبا_المصححة",
            visible: true,
            locked: false,
            opacity: 0.8,
            zIndex: 2,
            fullText: "x".repeat(MAX_LAYER_TEXT_CHARACTERS + 1),
          },
        ],
      },
    });
    expect(oversized.statusCode).toBe(400);
    expect(oversized.json().error.code).toBe("VALIDATION_FAILED");
  });
});

function createDocument(projectId: string): LayerDocument {
  return {
    schemaVersion: "1.0",
    projectId,
    sourceVersionId,
    revision: 1,
    generatedAt: "2026-07-30T17:00:00.000Z",
    width: 1000,
    height: 1400,
    colorSpace: "sRGB",
    pages: [{ pageNumber: 1, width: 1000, height: 1400 }],
    layers: [
      {
        id: "page-1",
        parentId: null,
        kind: "group",
        name: "+page_001",
        visible: true,
        locked: true,
        opacity: 1,
        fixed: true,
        zIndex: 0,
        pageNumber: 1,
      },
      {
        id: "background",
        parentId: "page-1",
        kind: "raster",
        name: "+page_001_background",
        visible: true,
        locked: true,
        opacity: 1,
        fixed: true,
        zIndex: 0,
        pageNumber: 1,
      },
      ...[
        ["text-a", "مرحبا بالعالم", 0],
        ["text-b", "سطر ثان", 1],
      ].map(([id, fullText, order]) => ({
        id: String(id),
        parentId: "page-1",
        kind: "text" as const,
        name: `+${String(id)}` as `+${string}`,
        visible: true,
        locked: false,
        opacity: 1,
        fixed: false,
        zIndex: Number(order) + 1,
        fullText: String(fullText),
        pageNumber: 1,
        bounds: {
          x: 500,
          y: 100 + Number(order) * 80,
          width: 400,
          height: 60,
        },
        readingOrder: Number(order),
        direction: "rtl" as const,
      })),
    ],
  };
}
