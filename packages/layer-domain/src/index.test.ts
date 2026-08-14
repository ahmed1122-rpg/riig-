import type { LayerDocument, LayerNode } from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import {
  applyLayerDocumentCommand,
  canMergeTextLayers,
  normalizeDocumentLayerNames,
  validateProductionDocument,
} from "./index.js";

function layer(overrides: Partial<LayerNode> & Pick<LayerNode, "id" | "name">): LayerNode {
  return {
    parentId: "page-1",
    kind: "text",
    visible: true,
    locked: false,
    opacity: 1,
    fixed: false,
    zIndex: 1,
    pageNumber: 1,
    ...overrides,
  };
}

function document(layers: LayerNode[]): LayerDocument {
  return {
    schemaVersion: "1.0",
    projectId: "project-1",
    sourceVersionId: "source-1",
    revision: 1,
    width: 100,
    height: 100,
    colorSpace: "sRGB",
    pages: [{ pageNumber: 1, width: 100, height: 100 }],
    layers,
  };
}

function validLayers(): LayerNode[] {
  return [
    layer({ id: "page-1", parentId: null, kind: "group", name: "+page_001", fixed: true, locked: true, zIndex: 0 }),
    layer({ id: "background-1", kind: "raster", name: "+page_001_background", fixed: true, locked: true, zIndex: 0 }),
    layer({ id: "text-1", name: "+عنوان", readingOrder: 0, bounds: { x: 50, y: 10, width: 20, height: 10 }, direction: "rtl" }),
  ];
}

describe("layer graph validation", () => {
  it("accepts a valid PDF page folder graph", () => {
    expect(validateProductionDocument(document(validLayers()), "book")).toEqual([]);
  });

  it("reports duplicate ids, orphan parents, empty groups, and duplicate sibling names", () => {
    const layers = validLayers();
    layers.push(layer({ id: "text-1", parentId: "missing", name: "+يتيم" }));
    layers.push(layer({ id: "duplicate-name", name: "+عنوان" }));
    layers.push(layer({ id: "empty", kind: "group", name: "+فارغ" }));
    const codes = validateProductionDocument(document(layers), "book").map((entry) => entry.code);
    expect(codes).toEqual(expect.arrayContaining([
      "DUPLICATE_LAYER_ID",
      "DUPLICATE_LAYER_NAME",
      "MISSING_LAYER_PARENT",
      "EMPTY_LAYER_GROUP",
    ]));
  });

  it("detects parent cycles and cross-page parents", () => {
    const layers = validLayers();
    layers.push(layer({ id: "group-a", parentId: "group-b", kind: "group", name: "+a" }));
    layers.push(layer({ id: "group-b", parentId: "group-a", kind: "group", name: "+b" }));
    layers.push(layer({ id: "cross", parentId: "page-1", name: "+cross", pageNumber: 2 }));
    const codes = validateProductionDocument(document(layers), "book").map((entry) => entry.code);
    expect(codes).toContain("LAYER_PARENT_CYCLE");
    expect(codes).toContain("CROSS_PAGE_PARENT");
  });
});

describe("layer naming and commands", () => {
  it("normalizes and de-duplicates names inside one folder", () => {
    const input = document([
      ...validLayers(),
      layer({ id: "text-2", name: "+عنوان" }),
      layer({ id: "text-3", name: "++unsafe/" as `+${string}` }),
    ]);
    const result = normalizeDocumentLayerNames(input);
    expect(result.document.layers.map((entry) => entry.name)).toEqual([
      "+page_001",
      "+page_001_background",
      "+عنوان",
      "+عنوان_2",
      "+unsafe-",
    ]);
  });

  it("preserves locked names and reserves them while normalizing siblings", () => {
    const input = document([
      ...validLayers(),
      layer({ id: "locked", name: "+reserved", locked: true }),
      layer({ id: "editable", name: "+reserved" }),
    ]);
    const result = normalizeDocumentLayerNames(input);
    expect(result.document.layers.find((entry) => entry.id === "locked")?.name)
      .toBe("+reserved");
    expect(result.document.layers.find((entry) => entry.id === "editable")?.name)
      .toBe("+reserved_2");
    expect(result.affectedLayerIds).toEqual(["editable"]);
  });

  it("applies a 5,000-layer state change atomically and rejects a larger scope", () => {
    const layers = Array.from({ length: 5_000 }, (_, index) =>
      layer({ id: `layer-${index}`, name: `+layer_${index}`, parentId: null }),
    );
    const input = document(layers);
    const result = applyLayerDocumentCommand(input, {
      kind: "update-state",
      scope: { kind: "document" },
      visible: false,
    });
    expect(result.affectedLayerIds).toHaveLength(5_000);
    expect(result.document.layers.every((entry) => !entry.visible)).toBe(true);
    expect(() => applyLayerDocumentCommand(input, {
      kind: "update-state",
      scope: { kind: "layers", layerIds: Array.from({ length: 5_001 }, (_, index) => `id-${index}`) },
      locked: true,
    })).toThrow(/5,000/u);
  });

  it("orders RTL siblings by page geometry and reverses them", () => {
    const input = document([
      ...validLayers(),
      layer({ id: "text-2", name: "+ثان", bounds: { x: 10, y: 10, width: 20, height: 10 }, direction: "rtl" }),
    ]);
    const arranged = applyLayerDocumentCommand(input, {
      kind: "arrange-reading-order",
      scope: { kind: "page", pageNumber: 1 },
      order: "reading",
    });
    expect(arranged.document.layers.slice(2).map((entry) => entry.id)).toEqual(["text-1", "text-2"]);
    const reversed = applyLayerDocumentCommand(arranged.document, {
      kind: "arrange-reading-order",
      scope: { kind: "parent", parentId: "page-1" },
      order: "reverse",
    });
    expect(reversed.document.layers.slice(2).map((entry) => entry.id)).toEqual(["text-2", "text-1"]);
  });

  it("moves only editable siblings and reindexes their order", () => {
    const input = document([
      ...validLayers(),
      layer({ id: "text-2", name: "+ثان", fullText: "ثان", bounds: { x: 10, y: 20, width: 20, height: 10 } }),
    ]);
    const moved = applyLayerDocumentCommand(input, {
      kind: "move-layer",
      layerId: "text-2",
      targetLayerId: "text-1",
      position: "before",
    });
    expect(moved.document.layers.slice(2).map((entry) => entry.id)).toEqual(["text-2", "text-1"]);
    expect(() => applyLayerDocumentCommand(input, {
      kind: "move-layer",
      layerId: "text-2",
      targetLayerId: "background-1",
      position: "before",
    })).toThrow(/editable siblings/u);
  });

  it("keeps locked layers fixed during move and arrange commands", () => {
    const locked = layer({
      id: "locked",
      name: "+locked",
      locked: true,
      zIndex: 42,
      readingOrder: 1,
      bounds: { x: 20, y: 20, width: 20, height: 10 },
    });
    const input = document([
      ...validLayers(),
      locked,
      layer({
        id: "text-3",
        name: "+third",
        readingOrder: 2,
        bounds: { x: 10, y: 30, width: 20, height: 10 },
      }),
    ]);
    const arranged = applyLayerDocumentCommand(input, {
      kind: "arrange-reading-order",
      scope: { kind: "page", pageNumber: 1 },
      order: "reverse",
    });
    expect(arranged.document.layers.slice(2).map((entry) => entry.id))
      .toEqual(["text-3", "locked", "text-1"]);
    expect(arranged.document.layers.find((entry) => entry.id === "locked"))
      .toMatchObject({ zIndex: 42, readingOrder: 1 });
    expect(() => applyLayerDocumentCommand(input, {
      kind: "move-layer",
      layerId: "text-1",
      targetLayerId: "text-3",
      position: "after",
    })).toThrow(/editable siblings/u);
    expect(() => applyLayerDocumentCommand(input, {
      kind: "move-layer",
      layerId: "locked",
      targetLayerId: "text-3",
      position: "after",
    })).toThrow(/editable siblings/u);
  });
});

describe("merge eligibility", () => {
  it("rejects cross-page and protected text layers before the API call", () => {
    const layers = validLayers();
    layers.push(layer({ id: "text-2", name: "+ثان", pageNumber: 2 }));
    expect(canMergeTextLayers(layers, ["text-1", "text-2"])).toEqual({ allowed: false, reason: "PAGE" });
    layers[3] = { ...layers[3]!, pageNumber: 1, locked: true };
    expect(canMergeTextLayers(layers, ["text-1", "text-2"])).toEqual({ allowed: false, reason: "PROTECTED" });
  });
});
