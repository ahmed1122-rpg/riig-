import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_LAYERS,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MEBIBYTES,
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_ITEMS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  acceptedSourceTypes,
  evaluatePasswordRequirements,
  exportFormats,
  exportFormatsByProjectKind,
  layerLayoutMetadata,
  isStrongPassword,
  supportsExportFormat,
  type ImageGuidanceKind,
  type LayerDocument,
  type LayerNode,
  type PdfMarkerKind,
  type ProcessingMode,
} from "./index.js";

describe("upload contract", () => {
  it("locks the server contract to 30 MiB", () => {
    expect(MAX_UPLOAD_MEBIBYTES).toBe(30);
    expect(MAX_UPLOAD_BYTES).toBe(31_457_280);
    expect(MAX_PDF_PAGES).toBe(250);
    expect(MAX_PDF_TEXT_ITEMS).toBe(100_000);
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

  it("publishes one export capability matrix for every project kind", () => {
    expect(exportFormats).toEqual([
      "psd",
      "png-layers-json",
      "layered-tiff",
      "transparent-pngs",
      "txt",
      "csv",
      "json",
    ]);
    expect(exportFormatsByProjectKind).toEqual({
      image: [
        "psd",
        "png-layers-json",
        "layered-tiff",
        "transparent-pngs",
      ],
      book: ["psd", "png-layers-json", "txt", "csv", "json"],
    });
    expect(supportsExportFormat("book", "psd")).toBe(true);
    expect(supportsExportFormat("book", "layered-tiff")).toBe(false);
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

describe("password contract", () => {
  it("keeps the client and API requirements in one explicit policy", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
    expect(evaluatePasswordRequirements("Short1")).toEqual({
      length: false,
      lowercaseLatin: true,
      uppercaseLatin: true,
      number: true,
    });
    expect(evaluatePasswordRequirements("طويلة-بدون-latin-1")).toEqual({
      length: true,
      lowercaseLatin: true,
      uppercaseLatin: false,
      number: true,
    });
    expect(isStrongPassword("SecurePass1")).toBe(true);
    expect(isStrongPassword("securepass1")).toBe(false);
    expect(isStrongPassword(`SecurePass1${"x".repeat(118)}`)).toBe(false);
  });
});
