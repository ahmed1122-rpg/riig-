import { describe, expect, it } from "vitest";
import type { LayerDocument, LayerStateUpdate } from "@motionprep/contracts";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { InMemoryUploadRepository } from "../uploads/upload-repository.js";
import { InMemoryObjectStorage } from "../storage/object-storage.js";
import {
  InMemoryLayerDocumentRepository,
  InMemoryProcessingJobRepository,
} from "./processing-repository.js";
import {
  ProcessingDomainError,
  ProcessingService,
} from "./processing-service.js";

const projectId = "00000000-0000-4000-8000-000000000101";
const sourceVersionId = "00000000-0000-4000-8000-000000000102";
const actorUserId = "00000000-0000-4000-8000-000000000103";

describe("ProcessingService document tools", () => {
  it("replays an autosave operation after an ambiguous client response", async () => {
    const { documents, service } = await createFixture();
    const updates: LayerStateUpdate[] = [
      {
        id: "text-a",
        name: "+مرحبا_بالعالم",
        visible: false,
        locked: false,
        opacity: 1,
        zIndex: 1,
      },
    ];

    const saved = await service.updateLayerStates(
      projectId,
      sourceVersionId,
      "book",
      1,
      updates,
      actorUserId,
      "autosave-operation-001",
    );
    const replay = await service.updateLayerStates(
      projectId,
      sourceVersionId,
      "book",
      1,
      updates,
      actorUserId,
      "autosave-operation-001",
    );

    expect(saved.revision).toBe(2);
    expect(replay.revision).toBe(2);
    expect((await documents.findBySource(projectId, sourceVersionId))?.revision)
      .toBe(2);
    await expect(
      service.updateLayerStates(
        projectId,
        sourceVersionId,
        "book",
        1,
        [{ ...updates[0]!, visible: true }],
        actorUserId,
        "autosave-operation-001",
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("splits text idempotently and persists undo and redo snapshots", async () => {
    const { documents, service } = await createFixture();
    const input = {
      projectId,
      sourceVersionId,
      baseRevision: 1,
      layerId: "text-a",
      offset: 5,
      actorUserId,
      operationId: "split-operation-001",
    };

    const split = await service.splitPdfTextLayer(input);
    const replay = await service.splitPdfTextLayer(input);
    await expect(
      service.splitPdfTextLayer({ ...input, offset: 6 }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    expect(split.document.revision).toBe(2);
    expect(split.createdLayerIds).toHaveLength(1);
    expect(replay.createdLayerIds).toEqual(split.createdLayerIds);
    expect(replay.document.revision).toBe(2);
    expect(split.document.editTimeline?.entries.at(-1)?.requestHash).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect((await documents.findBySource(projectId, sourceVersionId))?.revision)
      .toBe(2);
    expect(textValues(split.document)).toContain("مرحبا");
    expect(textValues(split.document)).toContain(" بالعالم");

    const undone = await service.navigateEditHistory({
      projectId,
      sourceVersionId,
      baseRevision: 2,
      direction: "undo",
      actorUserId,
      operationId: "history-undo-split-001",
    });
    expect(undone.revision).toBe(3);
    expect(textValues(undone)).toContain("مرحبا بالعالم");
    expect(undone.editTimeline?.cursor).toBe(0);
    await expect(
      service.navigateEditHistory({
        projectId,
        sourceVersionId,
        baseRevision: 2,
        direction: "undo",
        actorUserId,
        operationId: "history-undo-split-001",
      }),
    ).resolves.toMatchObject({ revision: 3 });
    await expect(
      service.navigateEditHistory({
        projectId,
        sourceVersionId,
        baseRevision: 2,
        direction: "redo",
        actorUserId,
        operationId: "history-undo-split-001",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const redone = await service.navigateEditHistory({
      projectId,
      sourceVersionId,
      baseRevision: 3,
      direction: "redo",
      actorUserId,
      operationId: "history-redo-split-001",
    });
    expect(redone.revision).toBe(4);
    expect(textValues(redone)).toContain("مرحبا");
    expect(redone.editTimeline?.cursor).toBe(1);
  });

  it("merges same-page text without deleting recoverable history", async () => {
    const { service } = await createFixture();

    const merged = await service.mergePdfTextLayers({
      projectId,
      sourceVersionId,
      baseRevision: 1,
      layerIds: ["text-a", "text-b"],
      separator: "newline",
      actorUserId,
      operationId: "merge-operation-001",
    });

    expect(merged.document.revision).toBe(2);
    expect(merged.removedLayerIds).toEqual(["text-b"]);
    expect(textValues(merged.document)).toEqual([
      "مرحبا بالعالم\nسطر ثان",
    ]);

    const undone = await service.navigateEditHistory({
      projectId,
      sourceVersionId,
      baseRevision: 2,
      direction: "undo",
      actorUserId,
      operationId: "history-undo-merge-001",
    });
    expect(textValues(undone)).toEqual([
      "مرحبا بالعالم",
      "سطر ثان",
    ]);
  });

  it("rejects conflicting edits built on the same revision", async () => {
    const { service } = await createFixture();
    const results = await Promise.allSettled([
      service.splitPdfTextLayer({
        projectId,
        sourceVersionId,
        baseRevision: 1,
        layerId: "text-a",
        offset: 5,
        actorUserId,
        operationId: "split-concurrent-001",
      }),
      service.mergePdfTextLayers({
        projectId,
        sourceVersionId,
        baseRevision: 1,
        layerIds: ["text-a", "text-b"],
        separator: "space",
        actorUserId,
        operationId: "merge-concurrent-001",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled"))
      .toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toBeInstanceOf(ProcessingDomainError);
    expect((rejected?.reason as ProcessingDomainError).code).toBe(
      "DOCUMENT_REVISION_CONFLICT",
    );
  });

  it("stores edge refinement as a recoverable raster revision", async () => {
    const { documents, service, storage } = await createImageFixture();

    const refined = await service.refineImageLayerEdges({
      projectId,
      sourceVersionId,
      baseRevision: 1,
      layerId: "raster-a",
      radius: 1,
      strength: 0.7,
      actorUserId,
      operationId: "edge-refine-operation-001",
    });
    const refinedLayer = refined.document.layers.find(
      (layer) => layer.id === "raster-a",
    );

    expect(refined.document.revision).toBe(2);
    expect(refinedLayer?.rasterAsset?.objectKey).toContain(
      "/tools/revision-2/edge-refine-raster-a-edge-refine-operation-001.png",
    );
    expect(
      await storage.get(refinedLayer!.rasterAsset!.objectKey),
    ).not.toBeNull();

    const undone = await service.navigateEditHistory({
      projectId,
      sourceVersionId,
      baseRevision: 2,
      direction: "undo",
      actorUserId,
      operationId: "history-undo-refine-001",
    });
    expect(
      undone.layers.find((layer) => layer.id === "raster-a")?.rasterAsset
        ?.objectKey,
    ).toBe("source/raster-a.png");
    expect((await documents.findBySource(projectId, sourceVersionId))?.revision)
      .toBe(3);
  });

  it("rejects guided refinement when the referenced raster bytes are corrupted", async () => {
    const { service, storage } = await createImageFixture();
    const original = await storage.get("source/raster-a.png");
    const tampered = Buffer.from(original!.body);
    tampered[Math.floor(tampered.length / 2)]! ^= 0xff;
    await storage.put({
      key: original!.key,
      contentType: original!.contentType,
      sizeBytes: tampered.byteLength,
      body: tampered,
    });

    await expect(
      service.applyGuidedRefinement({
        projectId,
        sourceVersionId,
        projectKind: "image",
        baseRevision: 1,
        mode: "guided",
        imageStrokes: [
          {
            id: "corrupt-raster-stroke",
            targetLayerId: "raster-a",
            kind: "separate",
            brushSize: 3,
            points: [
              { x: 0.2, y: 0.2 },
              { x: 0.3, y: 0.3 },
            ],
            createdAt: "2026-07-30T17:00:00.000Z",
          },
        ],
        pdfRegions: [],
        actorUserId,
        operationId: "corrupt-raster-operation-001",
      }),
    ).rejects.toMatchObject({ code: "LAYER_ASSET_INTEGRITY_FAILED" });
  });

  it("merges raster layers into one derived asset and restores both on undo", async () => {
    const { service, storage } = await createImageFixture();

    const merged = await service.mergeImageLayers({
      projectId,
      sourceVersionId,
      baseRevision: 1,
      layerIds: ["raster-a", "raster-b"],
      actorUserId,
      operationId: "image-merge-operation-001",
    });

    expect(merged.document.layers).toHaveLength(1);
    expect(merged.createdLayerIds).toHaveLength(1);
    expect(merged.removedLayerIds).toEqual(["raster-a", "raster-b"]);
    const mergedLayer = merged.document.layers[0]!;
    expect(mergedLayer.bounds).toEqual({ x: 0, y: 0, width: 3, height: 2 });
    expect(await storage.get(mergedLayer.rasterAsset!.objectKey)).not.toBeNull();

    const undone = await service.navigateEditHistory({
      projectId,
      sourceVersionId,
      baseRevision: 2,
      direction: "undo",
      actorUserId,
      operationId: "history-undo-image-merge-001",
    });
    expect(undone.layers.map((layer) => layer.id).sort()).toEqual([
      "raster-a",
      "raster-b",
    ]);
  });
});

async function createFixture(): Promise<{
  documents: InMemoryLayerDocumentRepository;
  service: ProcessingService;
}> {
  const documents = new InMemoryLayerDocumentRepository();
  await documents.save(createDocument());
  return {
    documents,
    service: new ProcessingService(
      new InMemoryProcessingJobRepository(),
      documents,
      new InMemoryUploadRepository(),
      new InMemoryObjectStorage(),
      () => new Date("2026-07-30T17:00:00.000Z"),
    ),
  };
}

function createDocument(): LayerDocument {
  return {
    schemaVersion: "1.0",
    projectId,
    sourceVersionId,
    revision: 1,
    generatedAt: "2026-07-30T16:00:00.000Z",
    width: 1000,
    height: 1400,
    colorSpace: "sRGB",
    pages: [{ pageNumber: 1, width: 1000, height: 1400 }],
    layers: [
      {
        id: "background",
        parentId: null,
        kind: "raster",
        name: "+page_001_background",
        visible: true,
        locked: true,
        opacity: 1,
        fixed: true,
        zIndex: 0,
        pageNumber: 1,
        bounds: { x: 0, y: 0, width: 1000, height: 1400 },
      },
      {
        id: "text-a",
        parentId: null,
        kind: "text",
        name: "+مرحبا_بالعالم",
        visible: true,
        locked: false,
        opacity: 1,
        fixed: false,
        zIndex: 1,
        fullText: "مرحبا بالعالم",
        pageNumber: 1,
        bounds: { x: 500, y: 100, width: 400, height: 60 },
        readingOrder: 0,
        direction: "rtl",
      },
      {
        id: "text-b",
        parentId: null,
        kind: "text",
        name: "+سطر_ثان",
        visible: true,
        locked: false,
        opacity: 1,
        fixed: false,
        zIndex: 2,
        fullText: "سطر ثان",
        pageNumber: 1,
        bounds: { x: 500, y: 180, width: 400, height: 60 },
        readingOrder: 1,
        direction: "rtl",
      },
    ],
  };
}

function textValues(document: LayerDocument): string[] {
  return document.layers.flatMap((layer) =>
    layer.kind === "text" && layer.fullText ? [layer.fullText] : [],
  );
}

async function createImageFixture(): Promise<{
  documents: InMemoryLayerDocumentRepository;
  service: ProcessingService;
  storage: InMemoryObjectStorage;
}> {
  const storage = new InMemoryObjectStorage();
  const red = await solidPng(2, 2, [255, 0, 0, 255]);
  const blue = await solidPng(2, 2, [0, 0, 255, 255]);
  await Promise.all([
    storeRaster(storage, "source/raster-a.png", red),
    storeRaster(storage, "source/raster-b.png", blue),
  ]);
  const documents = new InMemoryLayerDocumentRepository();
  await documents.save({
    schemaVersion: "1.0",
    projectId,
    sourceVersionId,
    revision: 1,
    generatedAt: "2026-07-30T16:00:00.000Z",
    width: 3,
    height: 2,
    colorSpace: "sRGB",
    imagePreparation: {
      strategy: "alpha-components",
      detectedComponents: 2,
      outputLayers: 2,
      overflowMerged: false,
    },
    layers: [
      rasterLayer("raster-a", "source/raster-a.png", red, {
        x: 0,
        y: 0,
        width: 2,
        height: 2,
      }, 1),
      rasterLayer("raster-b", "source/raster-b.png", blue, {
        x: 1,
        y: 0,
        width: 2,
        height: 2,
      }, 2),
    ],
  });
  return {
    documents,
    storage,
    service: new ProcessingService(
      new InMemoryProcessingJobRepository(),
      documents,
      new InMemoryUploadRepository(),
      storage,
      () => new Date("2026-07-30T17:00:00.000Z"),
    ),
  };
}

function rasterLayer(
  id: string,
  objectKey: string,
  body: Buffer,
  bounds: { x: number; y: number; width: number; height: number },
  zIndex: number,
) {
  return {
    id,
    parentId: null,
    kind: "raster" as const,
    name: `+${id}` as `+${string}`,
    visible: true,
    locked: false,
    opacity: 1,
    fixed: false,
    zIndex,
    confidence: 1,
    bounds,
    rasterAsset: {
      objectKey,
      contentType: "image/png" as const,
      sizeBytes: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
    },
  };
}

function solidPng(
  width: number,
  height: number,
  rgba: [number, number, number, number],
): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels.set(rgba, index);
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

async function storeRaster(
  storage: InMemoryObjectStorage,
  key: string,
  body: Buffer,
): Promise<void> {
  await storage.put({
    key,
    contentType: "image/png",
    sizeBytes: body.byteLength,
    body,
  });
}
