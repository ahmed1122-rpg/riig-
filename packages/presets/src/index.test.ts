import { describe, expect, it } from "vitest";
import {
  builtInPresets,
  createPdfBackgroundLayerName,
  createPdfTextLayerName,
  normalizeLayerName,
  validateProductionDocument,
} from "./index.js";

describe("normalizeLayerName", () => {
  it("adds exactly one plus prefix", () => {
    expect(normalizeLayerName("++الرأس")).toBe("+الرأس");
  });

  it("removes path separators and control characters", () => {
    expect(normalizeLayerName("../head\u0000")).toBe("+..-head");
  });

  it("uses a stable fallback for an empty name", () => {
    expect(normalizeLayerName("   ")).toBe("+layer");
  });
});

describe("production presets", () => {
  it("caps image assets at 15 layers", () => {
    expect(builtInPresets.characterBasic.maxLayers).toBe(15);
  });

  it("does not apply a layer-count limit to PDF presets", () => {
    expect(builtInPresets.kineticWords.maxLayers).toBeNull();
    expect(builtInPresets.kineticLines.maxLayers).toBeNull();
  });

  it("names the fixed white page background consistently", () => {
    expect(createPdfBackgroundLayerName(1)).toBe("+page_001_background");
    expect(createPdfBackgroundLayerName(12)).toBe("+page_012_background");
  });

  it("uses the separated PDF content as the readable layer name", () => {
    expect(createPdfTextLayerName("هذه جملة توضيحية", "sentence")).toBe(
      "+هذه_جملة_توضيحية",
    );
    expect(createPdfTextLayerName("م", "character")).toBe("+حرف_م");
  });

  it("blocks an image document with more than 15 content layers", () => {
    const layers = Array.from({ length: 16 }, (_, index) => ({
      id: `layer-${index}`,
      parentId: null,
      kind: "raster" as const,
      name: `+layer_${index}` as const,
      visible: true,
      locked: false,
      opacity: 1,
      fixed: false,
      zIndex: index,
    }));

    const issues = validateProductionDocument(
      {
        schemaVersion: "1.0",
        projectId: "project-image",
        width: 1920,
        height: 1080,
        colorSpace: "sRGB",
        layers,
      },
      "image",
    );

    expect(issues.map((issue) => issue.code)).toContain(
      "IMAGE_LAYER_LIMIT_EXCEEDED",
    );
  });

  it("rejects missing, duplicate, and out-of-canvas prepared raster assets", () => {
    const reference = {
      objectKey: "derived/project/source/layers/shared.png",
      contentType: "image/png" as const,
      sizeBytes: 10,
      sha256: "a".repeat(64),
    };
    const issues = validateProductionDocument(
      {
        schemaVersion: "1.0",
        projectId: "project-image",
        sourceVersionId: "source",
        width: 100,
        height: 80,
        colorSpace: "sRGB",
        imagePreparation: {
          strategy: "alpha-components",
          detectedComponents: 3,
          outputLayers: 3,
          overflowMerged: false,
        },
        layers: [
          {
            id: "missing",
            parentId: null,
            kind: "raster",
            name: "+missing",
            visible: true,
            locked: false,
            opacity: 1,
            fixed: false,
            zIndex: 0,
          },
          {
            id: "first",
            parentId: null,
            kind: "raster",
            name: "+first",
            visible: true,
            locked: false,
            opacity: 1,
            fixed: false,
            zIndex: 1,
            rasterAsset: reference,
          },
          {
            id: "duplicate",
            parentId: null,
            kind: "raster",
            name: "+duplicate",
            visible: true,
            locked: false,
            opacity: 1,
            fixed: false,
            zIndex: 2,
            bounds: { x: 95, y: 70, width: 10, height: 20 },
            rasterAsset: reference,
          },
        ],
      },
      "image",
    );

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "IMAGE_RASTER_ASSET_MISSING",
        "IMAGE_RASTER_ASSET_DUPLICATE",
        "IMAGE_RASTER_BOUNDS_INVALID",
      ]),
    );
  });

  it("accepts one fixed and locked white background per PDF page", () => {
    const issues = validateProductionDocument(
      {
        schemaVersion: "1.0",
        projectId: "project-book",
        width: 1080,
        height: 1440,
        colorSpace: "sRGB",
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
          },
          {
            id: "word",
            parentId: null,
            kind: "text",
            name: "+مرحبا",
            visible: true,
            locked: false,
            opacity: 1,
            fixed: false,
            zIndex: 1,
            pageNumber: 1,
            fullText: "مرحبا",
          },
        ],
      },
      "book",
    );

    expect(issues).toEqual([]);
  });

  it("never applies the image layer cap to a PDF document", () => {
    const textLayers = Array.from({ length: 750 }, (_, index) => ({
      id: `word-${index}`,
      parentId: null,
      kind: "text" as const,
      name: `+word_${index}` as const,
      visible: true,
      locked: false,
      opacity: 1,
      fixed: false,
      zIndex: index + 1,
      pageNumber: 1,
      fullText: `word ${index}`,
    }));

    const issues = validateProductionDocument(
      {
        schemaVersion: "1.0",
        projectId: "large-book",
        width: 1080,
        height: 1440,
        colorSpace: "sRGB",
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
          },
          ...textLayers,
        ],
      },
      "book",
    );

    expect(issues.map((issue) => issue.code)).not.toContain(
      "IMAGE_LAYER_LIMIT_EXCEEDED",
    );
  });
});
