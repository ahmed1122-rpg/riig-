import { describe, expect, it } from "vitest";
import type { Layer } from "../../types";
import { resolveLayerSelection } from "./layerDockSelection";

const layers: Layer[] = [
  { id: "a", name: "A", kind: "text", visible: true, locked: false, opacity: 100, color: "#fff", pageNumber: 1 },
  { id: "b", name: "B", kind: "text", visible: true, locked: false, opacity: 100, color: "#fff", pageNumber: 1 },
  { id: "c", name: "C", kind: "text", visible: true, locked: false, opacity: 100, color: "#fff", pageNumber: 1 },
  { id: "d", name: "D", kind: "text", visible: true, locked: false, opacity: 100, color: "#fff", pageNumber: 2 },
];

describe("resolveLayerSelection", () => {
  it("selects a contiguous same-folder range", () => {
    expect(resolveLayerSelection({
      layers,
      selectedIds: ["a"],
      anchorId: "a",
      targetId: "c",
      shiftKey: true,
      toggleKey: false,
    })).toEqual(["a", "b", "c"]);
  });

  it("falls back to the target across page boundaries", () => {
    expect(resolveLayerSelection({
      layers,
      selectedIds: ["a"],
      anchorId: "a",
      targetId: "d",
      shiftKey: true,
      toggleKey: false,
    })).toEqual(["d"]);
  });

  it("never leaves the selection empty when toggling", () => {
    expect(resolveLayerSelection({
      layers,
      selectedIds: ["b"],
      anchorId: "b",
      targetId: "b",
      shiftKey: false,
      toggleKey: true,
    })).toEqual(["b"]);
  });
});
