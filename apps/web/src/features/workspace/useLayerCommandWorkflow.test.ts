import { describe, expect, it } from "vitest";
import type { Layer } from "../../types";
import { createLayerNormalizePreview } from "./useLayerCommandWorkflow";

describe("createLayerNormalizePreview", () => {
  it("previews only the current PDF page unless a multi-selection exists", () => {
    const layers = [layer("one", "عنوان/أول", 1), layer("two", "عنوان/ثان", 2)];

    const pagePreview = createLayerNormalizePreview({
      mode: "book",
      activePdfPage: 1,
      layers,
      selectedIds: ["one"],
    });
    expect(pagePreview.scope).toEqual({ kind: "page", pageNumber: 1 });
    expect(pagePreview.changes).toEqual([
      { id: "one", before: "عنوان/أول", after: "+عنوان-أول" },
    ]);

    const selectionPreview = createLayerNormalizePreview({
      mode: "book",
      activePdfPage: 1,
      layers,
      selectedIds: ["one", "two"],
    });
    expect(selectionPreview.scope).toEqual({ kind: "layers", layerIds: ["one", "two"] });
    expect(selectionPreview.changes).toHaveLength(2);
  });

  it("blocks a preview scope above the atomic command limit", () => {
    const layers = Array.from({ length: 5_001 }, (_, index) =>
      layer(`layer-${index}`, `طبقة/${index}`, 1));
    const preview = createLayerNormalizePreview({
      mode: "book",
      activePdfPage: 1,
      layers,
      selectedIds: [],
    });

    expect(preview.affectedCount).toBe(5_001);
    expect(preview.exceedsLimit).toBe(true);
  });
});

function layer(id: string, name: string, pageNumber: number): Layer {
  return {
    id,
    name,
    kind: "text",
    visible: true,
    locked: false,
    opacity: 100,
    color: "#3bb3a9",
    pageNumber,
  };
}
