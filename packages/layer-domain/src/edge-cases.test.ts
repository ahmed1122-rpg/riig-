import type { LayerDocument, LayerNode } from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import {
  canMergeRasterLayers,
  canMergeTextLayers,
  canonicalLayerName,
  createPdfBackgroundLayerName,
  createPdfPageGroupName,
  createPdfTextLayerName,
  createUniqueLayerName,
  isPdfPageRootGroup,
  isValidLayerName,
  layerNameScopeKey,
  normalizeDocumentLayerNames,
  normalizeLayerName,
  validateProductionDocument,
} from "./index.js";

function node(
  overrides: Partial<LayerNode> & Pick<LayerNode, "id" | "name">,
): LayerNode {
  return {
    parentId: "page-1",
    kind: "text",
    visible: true,
    locked: false,
    opacity: 1,
    fixed: false,
    zIndex: 1,
    pageNumber: 1,
    fullText: "content",
    bounds: { x: 1, y: 1, width: 10, height: 10 },
    direction: "rtl",
    ...overrides,
  };
}

function document(layers: LayerNode[], image = false): LayerDocument {
  return {
    schemaVersion: "1.0",
    projectId: "project",
    sourceVersionId: "source",
    width: 100,
    height: 100,
    colorSpace: "sRGB",
    pages: [{ pageNumber: 1, width: 100, height: 100 }],
    layers,
    ...(image
      ? {
          imagePreparation: {
            strategy: "alpha-components" as const,
            detectedComponents: layers.length,
            outputLayers: layers.length,
            overflowMerged: false,
          },
        }
      : {}),
  };
}

function pageLayers(): LayerNode[] {
  return [
    node({
      id: "page-1",
      name: "+page_001",
      kind: "group",
      parentId: null,
      fixed: true,
      locked: true,
    }),
    node({
      id: "background-1",
      name: "+page_001_background",
      kind: "raster",
      fixed: true,
      locked: true,
    }),
  ];
}

describe("merge eligibility edges", () => {
  const first = node({ id: "first", name: "+first" });
  const second = node({ id: "second", name: "+second" });

  it("covers every text rejection and the allowed path", () => {
    const valid = [first, second];
    const contentless = { ...second };
    delete contentless.fullText;
    expect(canMergeTextLayers(valid, ["first"])).toMatchObject({ reason: "COUNT" });
    expect(canMergeTextLayers(valid, ["first", "first"])).toMatchObject({ reason: "MISSING" });
    expect(canMergeTextLayers(valid, ["first", "missing"])).toMatchObject({ reason: "MISSING" });
    expect(canMergeTextLayers([{ ...first, kind: "raster" }, second], ["first", "second"])).toMatchObject({ reason: "KIND" });
    expect(canMergeTextLayers([{ ...first, fixed: true }, second], ["first", "second"])).toMatchObject({ reason: "PROTECTED" });
    expect(canMergeTextLayers([first, { ...second, parentId: "other" }], ["first", "second"])).toMatchObject({ reason: "PARENT" });
    expect(canMergeTextLayers([first, { ...second, direction: "ltr" }], ["first", "second"])).toMatchObject({ reason: "DIRECTION" });
    expect(canMergeTextLayers([first, { ...second, textAlign: "center" }], ["first", "second"])).toMatchObject({ reason: "ALIGNMENT" });
    expect(canMergeTextLayers([first, contentless], ["first", "second"])).toMatchObject({ reason: "CONTENT" });
    expect(canMergeTextLayers(valid, ["first", "second"])).toEqual({ allowed: true });
  });

  it("covers raster eligibility and its bounded count", () => {
    const rasters = [
      { ...first, kind: "raster" as const },
      { ...second, kind: "raster" as const },
    ];
    expect(canMergeRasterLayers(rasters, ["first"], 2)).toMatchObject({ reason: "COUNT" });
    expect(canMergeRasterLayers(rasters, ["first", "missing"])).toMatchObject({ reason: "MISSING" });
    expect(canMergeRasterLayers([first, rasters[1]!], ["first", "second"])).toMatchObject({ reason: "KIND" });
    expect(canMergeRasterLayers([{ ...rasters[0]!, locked: true }, rasters[1]!], ["first", "second"])).toMatchObject({ reason: "PROTECTED" });
    expect(canMergeRasterLayers([rasters[0]!, { ...rasters[1]!, parentId: "other" }], ["first", "second"])).toMatchObject({ reason: "PARENT" });
    expect(canMergeRasterLayers(rasters, ["first", "second"])).toEqual({ allowed: true });
  });
});

describe("naming edges", () => {
  it("normalizes unsafe, empty, long, semantic, and scoped names", () => {
    expect(normalizeLayerName(" ++unsafe/name\u0000 ")).toBe("+unsafe-name");
    expect(normalizeLayerName("+++ ")).toBe("+layer");
    expect(isValidLayerName("+safe")).toBe(true);
    expect(isValidLayerName("++unsafe")).toBe(false);
    expect(isValidLayerName("+unsafe/name")).toBe(false);
    expect(createPdfPageGroupName(0)).toBe("+page_001");
    expect(createPdfBackgroundLayerName(12)).toBe("+page_012_background");
    expect(createPdfTextLayerName("a".repeat(100), "heading").length).toBeLessThanOrEqual(61);
    expect(createPdfTextLayerName("A", "character")).toContain("A");
    expect(layerNameScopeKey({ parentId: null })).toBe("document:root");
    expect(canonicalLayerName("+ABC")).toBe("+abc");
  });

  it("identifies page roots, selection scope, and suffix fallback", () => {
    const root = pageLayers()[0]!;
    expect(isPdfPageRootGroup(root)).toBe(true);
    expect(isPdfPageRootGroup({ ...root, parentId: "other" })).toBe(false);
    const used = new Set(Array.from({ length: 9_999 }, (_, index) =>
      canonicalLayerName(index === 0 ? "+name" : `+name_${index + 1}`),
    ));
    expect(createUniqueLayerName("name", used)).toMatch(/^\+name_[a-z0-9]+$/u);

    const fixed = node({ id: "fixed", name: "+fixed", fixed: true });
    const editable = node({ id: "edit", name: "++bad/" as `+${string}` });
    const untouched = node({ id: "other", name: "+other" });
    const result = normalizeDocumentLayerNames(
      document([fixed, editable, untouched]),
      new Set(["edit"]),
    );
    expect(result.affectedLayerIds).toEqual(["edit"]);
    expect(result.document.layers.map((layer) => layer.name)).toEqual([
      "+fixed",
      "+bad-",
      "+other",
    ]);
  });
});

describe("production validation edges", () => {
  it("reports invalid graph and PDF structural states", () => {
    const layers = pageLayers();
    layers[0] = { ...layers[0]!, fixed: false };
    layers[1] = { ...layers[1]!, fixed: false, locked: false };
    layers.push(node({ id: "bad-parent", name: "+bad-parent", parentId: "background-1" }));
    layers.push(node({ id: "bad-prefix", name: "++bad" as `+${string}` }));
    layers.push(node({ id: "bad-name", name: "+bad/name" as `+${string}` }));
    const codes = validateProductionDocument(document(layers), "book").map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining([
      "PDF_PAGE_GROUP_INVALID",
      "PDF_BACKGROUND_NOT_FIXED",
      "LAYER_PARENT_NOT_GROUP",
      "INVALID_LAYER_PREFIX",
      "INVALID_LAYER_NAME",
    ]));
  });

  it("rejects non-finite or out-of-range layer state in the shared validator", () => {
    const layers = pageLayers();
    layers.push(node({
      id: "bad-opacity",
      name: "+bad-opacity",
      opacity: Number.NaN,
    }));
    layers.push(node({
      id: "bad-z-index",
      name: "+bad-z-index",
      zIndex: 1_000_001,
    }));
    layers.push(node({
      id: "bad-reading-order",
      name: "+bad-reading-order",
      readingOrder: -1,
    }));

    const codes = validateProductionDocument(document(layers), "book")
      .map((entry) => entry.code);

    expect(codes).toEqual(expect.arrayContaining([
      "LAYER_OPACITY_INVALID",
      "LAYER_Z_INDEX_INVALID",
      "LAYER_READING_ORDER_INVALID",
    ]));
  });

  it("reports missing PDF roots and backgrounds", () => {
    const noRoot = validateProductionDocument(
      document([node({ id: "text", name: "+text", parentId: null })]),
      "book",
    );
    expect(noRoot.map((issue) => issue.code)).toContain("PDF_PAGE_GROUP_MISSING");
    const noBackground = validateProductionDocument(document([pageLayers()[0]!]), "book");
    expect(noBackground.map((issue) => issue.code)).toContain("PDF_BACKGROUND_MISSING");
  });

  it("reports raster assets, bounds, duplicate keys, and image layer limits", () => {
    const rasters = Array.from({ length: 16 }, (_, index) => {
      const raster = node({
        id: `raster-${index}`,
        name: `+raster_${index}`,
        kind: "raster",
        parentId: null,
        ...(index === 1
          ? { bounds: { x: -1, y: 0, width: 200, height: 0 } }
          : {}),
        ...(index === 0
          ? {}
          : {
              rasterAsset: {
                objectKey: index < 3 ? "duplicate" : `key-${index}`,
                contentType: "image/png" as const,
                sizeBytes: 1,
                sha256: "a".repeat(64),
              },
            }),
      });
      delete raster.pageNumber;
      if (index !== 1) delete raster.bounds;
      return raster;
    });
    const codes = validateProductionDocument(document(rasters, true), "image").map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining([
      "IMAGE_LAYER_LIMIT_EXCEEDED",
      "IMAGE_RASTER_ASSET_MISSING",
      "IMAGE_RASTER_ASSET_DUPLICATE",
      "IMAGE_RASTER_BOUNDS_INVALID",
    ]));
  });
});
