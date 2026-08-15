import { describe, expect, it } from "vitest";
import type { Layer } from "../../types";
import { evaluateExportPreflight } from "./exportPreflight";

const layer = (changes: Partial<Layer>): Layer => ({
  id: "layer",
  name: "+layer",
  kind: "text",
  visible: true,
  locked: false,
  opacity: 100,
  color: "#000000",
  ...changes,
});

describe("evaluateExportPreflight", () => {
  it("reports a valid page-folder graph as ready", () => {
    const root = layer({
      id: "root",
      name: "+page_001",
      kind: "group",
      parentId: null,
      pageNumber: 1,
      fixed: true,
      locked: true,
    });
    const result = evaluateExportPreflight({
      mode: "book",
      canExport: true,
      saveState: "saved",
      pdfPages: [{ pageNumber: 1, width: 612, height: 792 }],
      layers: [
        root,
        layer({
          id: "background",
          name: "+page_001_background",
          kind: "raster",
          presentationKind: "page",
          parentId: root.id,
          pageNumber: 1,
          fixed: true,
          locked: true,
        }),
        layer({ id: "text", parentId: root.id, pageNumber: 1 }),
      ],
    });
    expect(result).toEqual({ status: "ready", findings: [] });
  });

  it("blocks invalid graph/save states and treats dirty state as a warning", () => {
    const blocked = evaluateExportPreflight({
      mode: "book",
      canExport: true,
      saveState: "conflict",
      pdfPages: [{ pageNumber: 1, width: 1, height: 1 }],
      layers: [],
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.findings.map(({ key }) => key)).toContain("save-conflict");
    expect(blocked.findings.some(({ key }) => key.startsWith("PDF_PAGE_GROUP_MISSING"))).toBe(true);

    expect(evaluateExportPreflight({
      mode: "image",
      canExport: true,
      saveState: "dirty",
      layers: [layer({ kind: "raster", presentationKind: "body" })],
    }).status).toBe("warning");
  });
});
