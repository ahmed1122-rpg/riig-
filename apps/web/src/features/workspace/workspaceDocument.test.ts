import { describe, expect, it } from "vitest";
import type { LayerDocumentView } from "../../lib/api";
import { stableLayerColor, toWorkspaceLayers } from "./workspaceDocument";
import { toDomainLayer } from "./workspaceLayerDomain";

describe("toWorkspaceLayers", () => {
  it("retains PDF group kinds and parent ownership", () => {
    const document: LayerDocumentView = {
      schemaVersion: "1.0",
      projectId: "project",
      sourceVersionId: "source",
      revision: 1,
      generatedAt: "2026-08-13T00:00:00.000Z",
      width: 400,
      height: 300,
      colorSpace: "sRGB",
      pages: [{ pageNumber: 1, width: 400, height: 300 }],
      layers: [
        {
          id: "page-root",
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
          id: "text",
          parentId: "page-root",
          kind: "text",
          name: "+intro",
          visible: true,
          locked: false,
          opacity: 1,
          fixed: false,
          zIndex: 1,
          pageNumber: 1,
          fullText: "Intro",
          textAlign: "end",
        },
      ],
    };

    const workspaceLayers = toWorkspaceLayers(document, "book");
    expect(workspaceLayers).toEqual([
      expect.objectContaining({
        id: "page-root",
        kind: "group",
        parentId: null,
      }),
      expect.objectContaining({
        id: "text",
        kind: "text",
        parentId: "page-root",
        fullText: "Intro",
        textAlign: "end",
      }),
    ]);
    expect(toDomainLayer(workspaceLayers[1]!)).toEqual(
      expect.objectContaining({
        id: "text",
        fullText: "Intro",
        parentId: "page-root",
      }),
    );
  });

  it("derives layer colors from stable IDs instead of list order", () => {
    const first = stableLayerColor("layer-first");
    const second = stableLayerColor("layer-second");

    expect(stableLayerColor("layer-first")).toBe(first);
    expect(stableLayerColor("layer-second")).toBe(second);
    expect([first, second].every((color) => /^#[0-9a-f]{6}$/u.test(color))).toBe(true);
  });

  it("keeps the domain kind canonical while deriving the PDF page presentation", () => {
    const document: LayerDocumentView = {
      schemaVersion: "1.0",
      projectId: "project",
      sourceVersionId: "source",
      revision: 1,
      generatedAt: "2026-08-15T00:00:00.000Z",
      width: 400,
      height: 300,
      colorSpace: "sRGB",
      layers: [
        {
          id: "background",
          parentId: "page-root",
          kind: "raster",
          name: "+page_001_background",
          visible: true,
          locked: true,
          opacity: 1,
          fixed: true,
          zIndex: 0,
          pageNumber: 1,
        },
      ],
    };

    const [background] = toWorkspaceLayers(document, "book");

    expect(background).toMatchObject({
      kind: "raster",
      presentationKind: "page",
      fixed: true,
    });
    expect(toDomainLayer(background!)).toMatchObject({
      kind: "raster",
      fixed: true,
      pageNumber: 1,
    });
  });

  it("exposes raster availability without leaking storage object keys", () => {
    const document: LayerDocumentView = {
      schemaVersion: "1.0",
      projectId: "project",
      sourceVersionId: "source",
      revision: 1,
      generatedAt: "2026-08-14T00:00:00.000Z",
      width: 100,
      height: 100,
      colorSpace: "sRGB",
      layers: [
        {
          id: "with-asset",
          parentId: null,
          kind: "raster",
          name: "+with_asset",
          visible: true,
          locked: false,
          opacity: 1,
          fixed: false,
          zIndex: 2,
          rasterAsset: {
            objectKey: "private/project/layer.png",
            contentType: "image/png",
            sizeBytes: 10,
            sha256: "a".repeat(64),
          },
        },
        {
          id: "without-asset",
          parentId: null,
          kind: "raster",
          name: "+without_asset",
          visible: true,
          locked: false,
          opacity: 1,
          fixed: false,
          zIndex: 1,
        },
      ],
    };

    const workspaceLayers = toWorkspaceLayers(document, "image");
    expect(workspaceLayers).toEqual([
      expect.objectContaining({ id: "with-asset", hasRasterAsset: true }),
      expect.objectContaining({ id: "without-asset", hasRasterAsset: false }),
    ]);
    expect(JSON.stringify(workspaceLayers)).not.toContain("private/project");
  });
});
