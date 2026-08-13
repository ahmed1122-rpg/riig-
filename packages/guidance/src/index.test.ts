import { describe, expect, it } from "vitest";
import {
  canCreateSeparateImageLayer,
  applyPdfMarkerRegions,
  createImageGuidanceStroke,
  createPdfMarkerRegion,
  guidanceBounds,
  normalizePoint,
} from "./index.js";

describe("image guidance", () => {
  it("normalizes points and clamps brush size", () => {
    const stroke = createImageGuidanceStroke({
      id: "stroke-1",
      targetLayerId: "arm",
      kind: "include",
      brushSize: 200,
      points: [normalizePoint(-1, 0.5), normalizePoint(2, 1.5)],
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(stroke.brushSize).toBe(80);
    expect(stroke.points).toEqual([
      { x: 0, y: 0.5 },
      { x: 1, y: 1 },
    ]);
  });

  it("reprocesses only an expanded local bounding region", () => {
    const bounds = guidanceBounds([
      { x: 0.4, y: 0.3 },
      { x: 0.6, y: 0.7 },
    ]);

    expect(bounds?.x).toBeCloseTo(0.37);
    expect(bounds?.y).toBeCloseTo(0.27);
    expect(bounds?.width).toBeCloseTo(0.26);
    expect(bounds?.height).toBeCloseTo(0.46);
  });

  it("blocks a separate image layer after the 15-layer cap", () => {
    expect(canCreateSeparateImageLayer(14)).toBe(true);
    expect(canCreateSeparateImageLayer(15)).toBe(false);
  });
});

describe("PDF markers", () => {
  it("normalizes a dragged rectangle and reading order", () => {
    const region = createPdfMarkerRegion({
      id: "region-1",
      pageNumber: 0,
      kind: "heading",
      start: { x: 0.8, y: 0.4 },
      end: { x: 0.2, y: 0.1 },
      readingOrder: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(region.pageNumber).toBe(1);
    expect(region.start).toEqual({ x: 0.2, y: 0.1 });
    expect(region.end).toEqual({ x: 0.8, y: 0.4 });
  });

  it("groups matching text while preserving the fixed background", () => {
    const result = applyPdfMarkerRegions(
      {
        schemaVersion: "1.0",
        projectId: "book",
        sourceVersionId: "source",
        width: 400,
        height: 300,
        colorSpace: "sRGB",
        pages: [{ pageNumber: 1, width: 400, height: 300 }],
        layers: [
          {
            id: "page-group",
            parentId: null,
            kind: "group",
            name: "+page_001",
            visible: true,
            locked: true,
            opacity: 1,
            fixed: true,
            zIndex: 0,
            pageNumber: 1,
            bounds: { x: 0, y: 0, width: 400, height: 300 },
          },
          {
            id: "background",
            parentId: "page-group",
            kind: "raster",
            name: "+page_001_background",
            visible: true,
            locked: true,
            opacity: 1,
            fixed: true,
            zIndex: 0,
            pageNumber: 1,
            bounds: { x: 0, y: 0, width: 400, height: 300 },
            fillColor: "#ffffff",
          },
          {
            id: "heading",
            parentId: "page-group",
            kind: "text",
            name: "+عنوان",
            fullText: "عنوان",
            visible: true,
            locked: false,
            opacity: 1,
            fixed: false,
            zIndex: 1,
            pageNumber: 1,
            bounds: { x: 40, y: 20, width: 320, height: 50 },
          },
        ],
      },
      [
        createPdfMarkerRegion({
          id: "region-heading",
          pageNumber: 1,
          kind: "heading",
          start: { x: 0.05, y: 0.02 },
          end: { x: 0.95, y: 0.3 },
          readingOrder: 1,
        }),
      ],
    );

    expect(result.createdLayerIds).toEqual(["guide-region-heading"]);
    expect(result.document.layers.find((layer) => layer.id === "heading"))
      .toMatchObject({ parentId: "guide-region-heading", visible: true });
    expect(result.document.layers.find((layer) => layer.id === "background"))
      .toMatchObject({ locked: true, fixed: true, parentId: "page-group" });
    expect(
      result.document.layers.find((layer) => layer.id === "guide-region-heading"),
    ).toMatchObject({ parentId: "page-group", kind: "group" });

    const regrouped = applyPdfMarkerRegions(result.document, [
      createPdfMarkerRegion({
        id: "region-topic",
        pageNumber: 1,
        kind: "topic",
        start: { x: 0.05, y: 0.02 },
        end: { x: 0.95, y: 0.3 },
        readingOrder: 2,
      }),
    ]);
    expect(regrouped.document.layers.some(
      (layer) => layer.id === "guide-region-heading",
    )).toBe(false);
    expect(regrouped.createdLayerIds).toEqual(["guide-region-topic"]);

    const locked = applyPdfMarkerRegions(
      {
        ...result.document,
        layers: result.document.layers.map((layer) =>
          layer.id === "heading" ? { ...layer, locked: true } : layer,
        ),
      },
      [
        createPdfMarkerRegion({
          id: "region-ignore-locked",
          pageNumber: 1,
          kind: "ignore",
          start: { x: 0.05, y: 0.02 },
          end: { x: 0.95, y: 0.3 },
          readingOrder: null,
        }),
      ],
    );
    expect(locked.document.layers.find((layer) => layer.id === "heading"))
      .toMatchObject({ visible: true, locked: true });
    expect(locked.warnings).toContain("region:region-ignore-locked:no_text_layers");
  });
});
