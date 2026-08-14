import { describe, expect, it } from "vitest";
import type { LayerDocumentView } from "../../lib/api";
import { stableLayerColor, toWorkspaceLayers } from "./workspaceDocument";

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

    expect(toWorkspaceLayers(document, "book")).toEqual([
      expect.objectContaining({
        id: "page-root",
        kind: "group",
        parentId: null,
      }),
      expect.objectContaining({
        id: "text",
        kind: "text",
        parentId: "page-root",
        textAlign: "end",
      }),
    ]);
  });

  it("derives layer colors from stable IDs instead of list order", () => {
    const first = stableLayerColor("layer-first");
    const second = stableLayerColor("layer-second");

    expect(stableLayerColor("layer-first")).toBe(first);
    expect(stableLayerColor("layer-second")).toBe(second);
    expect([first, second].every((color) => /^#[0-9a-f]{6}$/u.test(color))).toBe(true);
  });
});
