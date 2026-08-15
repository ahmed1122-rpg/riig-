import type { LayerDocumentView } from "../../lib/api";
import type { Layer } from "../../types";
import { describe, expect, it } from "vitest";
import { summarizeDocumentChange } from "./documentChangeSummary";

describe("summarizeDocumentChange", () => {
  it("reports added, removed, and materially modified layers", () => {
    const before = [
      workspaceLayer("keep", "+old"),
      workspaceLayer("remove", "+removed"),
    ];
    const after = document([
      documentLayer("keep", "+new", { fullText: "نص جديد" }),
      documentLayer("add", "+added"),
    ]);

    expect(summarizeDocumentChange(7, "OCR", before, after)).toEqual({
      id: 7,
      label: "OCR",
      revision: 4,
      beforeCount: 2,
      afterCount: 2,
      added: ["+added"],
      removed: ["+removed"],
      modified: ["+new"],
    });
  });

  it("does not report preview-only workspace state as a document change", () => {
    const before = [
      { ...workspaceLayer("keep", "+same"), previewUrl: "blob:local", color: "#fff" },
    ];
    expect(summarizeDocumentChange(
      1,
      "تحسين",
      before,
      document([documentLayer("keep", "+same")]),
    ).modified).toEqual([]);
  });
});

function workspaceLayer(id: string, name: string): Layer {
  return {
    id,
    parentId: null,
    name,
    kind: "text",
    visible: true,
    locked: false,
    fixed: false,
    opacity: 100,
    zIndex: 1,
    readingOrder: 0,
    pageNumber: 1,
    direction: "rtl",
    textAlign: "start",
    fontFamily: "Noto Sans Arabic",
    fontSize: 16,
    fullText: "نص",
    bounds: { x: 1, y: 2, width: 3, height: 4 },
    color: "#000",
  };
}

function documentLayer(
  id: string,
  name: `+${string}`,
  overrides: Partial<LayerDocumentView["layers"][number]> = {},
): LayerDocumentView["layers"][number] {
  return {
    id,
    parentId: null,
    name,
    kind: "text",
    visible: true,
    locked: false,
    fixed: false,
    opacity: 1,
    zIndex: 1,
    readingOrder: 0,
    pageNumber: 1,
    direction: "rtl",
    textAlign: "start",
    fontFamily: "Noto Sans Arabic",
    fontSize: 16,
    fullText: "نص",
    bounds: { x: 1, y: 2, width: 3, height: 4 },
    ...overrides,
  };
}

function document(layers: LayerDocumentView["layers"]): LayerDocumentView {
  return {
    schemaVersion: "1.0",
    projectId: "project",
    sourceVersionId: "source",
    revision: 4,
    generatedAt: "2026-08-13T00:00:00.000Z",
    width: 100,
    height: 100,
    colorSpace: "sRGB",
    layers,
  };
}
