import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_LAYERS,
  MAX_UPLOAD_BYTES,
  acceptedSourceTypes,
  layerLayoutMetadata,
  type ImageGuidanceKind,
  type LayerDocument,
  type LayerNode,
  type PdfMarkerKind,
  type ProcessingMode,
} from "./index.js";

describe("upload contract", () => {
  it("locks the server contract to 30 MiB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(31_457_280);
  });

  it("allows only the initial supported source types", () => {
    expect(acceptedSourceTypes).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/avif",
      "image/tiff",
      "image/bmp",
      "application/pdf",
    ]);
  });

  it("caps visual assets at 15 layers", () => {
    expect(MAX_IMAGE_LAYERS).toBe(15);
  });

  it("exposes explicit automatic, manual, and guided processing contracts", () => {
    const modes: ProcessingMode[] = ["automatic", "manual", "guided"];
    const imageSignals: ImageGuidanceKind[] = [
      "include",
      "exclude",
      "separate",
    ];
    const pdfMarkers: PdfMarkerKind[] = [
      "heading",
      "line",
      "topic",
      "ignore",
    ];

    expect(modes).toHaveLength(3);
    expect(imageSignals).toContain("separate");
    expect(pdfMarkers).toContain("heading");
  });

  it("represents positioned PDF text without weakening image documents", () => {
    const document: LayerDocument = {
      schemaVersion: "1.0",
      projectId: crypto.randomUUID(),
      width: 595,
      height: 842,
      colorSpace: "sRGB",
      pages: [{ pageNumber: 1, width: 595, height: 842 }],
      layers: [
        {
          id: crypto.randomUUID(),
          parentId: null,
          kind: "text",
          name: "+مرحبا",
          visible: true,
          locked: false,
          opacity: 1,
          fixed: false,
          zIndex: 1,
          pageNumber: 1,
          bounds: { x: 20, y: 30, width: 100, height: 24 },
          readingOrder: 0,
          fullText: "مرحبا",
          direction: "rtl",
        },
      ],
    };

    expect(document.layers[0]?.bounds?.width).toBe(100);
    expect(document.layers[0]?.direction).toBe("rtl");
  });

  it("serializes optional layer layout metadata consistently", () => {
    const layer: LayerNode = {
      id: crypto.randomUUID(),
      parentId: null,
      kind: "text",
      name: "+عنوان",
      visible: true,
      locked: false,
      opacity: 1,
      fixed: false,
      zIndex: 1,
      pageNumber: 2,
      bounds: { x: 12, y: 20, width: 180, height: 36 },
      readingOrder: 4,
      direction: "rtl",
      fontFamily: "Noto Sans Arabic",
      fontSize: 24,
    };

    expect(layerLayoutMetadata(layer)).toEqual({
      pageNumber: 2,
      bounds: layer.bounds,
      readingOrder: 4,
      direction: "rtl",
      fontFamily: "Noto Sans Arabic",
      fontSize: 24,
    });
    const minimalLayer: LayerNode = {
      id: crypto.randomUUID(),
      parentId: null,
      kind: "raster",
      name: "+طبقة",
      visible: true,
      locked: false,
      opacity: 1,
      fixed: false,
      zIndex: 0,
    };
    expect(layerLayoutMetadata(minimalLayer)).toEqual({});
  });
});
