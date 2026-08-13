import type { LayerDocument, LayerNode } from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import { DocumentEditCoordinator } from "./document-edit-coordinator.js";
import { LayerCommandOperations } from "./layer-command-operations.js";
import { InMemoryLayerDocumentRepository } from "./processing-repository.js";

function textLayer(index: number): LayerNode {
  return {
    id: `layer-${index}`,
    parentId: null,
    kind: "text",
    name: `+layer_${index}`,
    visible: true,
    locked: false,
    opacity: 1,
    fixed: false,
    zIndex: index,
  };
}

function document(count: number): LayerDocument {
  return {
    schemaVersion: "1.0",
    projectId: "project-1",
    sourceVersionId: "source-1",
    revision: 1,
    width: 100,
    height: 100,
    colorSpace: "sRGB",
    layers: Array.from({ length: count }, (_, index) => textLayer(index)),
  };
}

describe("LayerCommandOperations", () => {
  it("persists a 5,000-layer batch as one revision and replays idempotently", async () => {
    const repository = new InMemoryLayerDocumentRepository();
    await repository.save(document(5_000));
    const operations = new LayerCommandOperations(
      new DocumentEditCoordinator(repository, () => new Date("2026-08-13T00:00:00Z")),
    );
    const input = {
      projectId: "project-1",
      sourceVersionId: "source-1",
      projectKind: "book" as const,
      baseRevision: 1,
      command: {
        kind: "update-state" as const,
        scope: { kind: "document" as const },
        locked: true,
      },
      actorUserId: "user-1",
      operationId: "operation-1",
    };

    const updated = await operations.apply(input);
    const replay = await operations.apply(input);

    expect(updated.revision).toBe(2);
    expect(updated.layers).toHaveLength(5_000);
    expect(updated.layers.every((layer) => layer.locked)).toBe(true);
    expect(replay).toEqual(updated);
    expect((await repository.findBySource("project-1", "source-1"))?.revision).toBe(2);
  });

  it("rejects unknown and duplicate explicit ids without changing the revision", async () => {
    const repository = new InMemoryLayerDocumentRepository();
    await repository.save(document(2));
    const operations = new LayerCommandOperations(
      new DocumentEditCoordinator(repository, () => new Date()),
    );
    await expect(operations.apply({
      projectId: "project-1",
      sourceVersionId: "source-1",
      projectKind: "book",
      baseRevision: 1,
      command: {
        kind: "update-state",
        scope: { kind: "layers", layerIds: ["layer-0", "layer-0"] },
        visible: false,
      },
      actorUserId: "user-1",
      operationId: "operation-2",
    })).rejects.toMatchObject({ code: "INVALID_DOCUMENT_OPERATION" });
    expect((await repository.findBySource("project-1", "source-1"))?.revision).toBe(1);
  });
});
