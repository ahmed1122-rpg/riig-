import { describe, expect, it } from "vitest";
import type { Layer } from "../../types";
import { renameExportLayer } from "./exportLayerRename";

const layers: Layer[] = [
  { id: "a", name: "+character", kind: "raster", visible: true, locked: false, opacity: 100, color: "#fff", pageNumber: 1 },
  { id: "b", name: "+shadow", kind: "raster", visible: true, locked: false, opacity: 100, color: "#fff", pageNumber: 1 },
];

describe("renameExportLayer", () => {
  it("ignores missing and fixed selections", () => {
    expect(renameExportLayer(layers, undefined, "New", false)).toBeNull();
    expect(renameExportLayer(layers, layers[0], "New", true)).toBeNull();
  });

  it("rejects a canonical duplicate in the same page and folder", () => {
    expect(renameExportLayer(layers, layers[0], " shadow ", false)).toBe(false);
  });

  it("returns a renamed copy without mutating the source", () => {
    const result = renameExportLayer(layers, layers[0], "Hero", false);
    expect(result).not.toBeNull();
    expect(result).not.toBe(false);
    if (!result) return;
    expect(result[0]).toBe("+Hero");
    expect(result[1].map(({ name }) => name)).toEqual(["+Hero", "+shadow"]);
    expect(layers[0]?.name).toBe("+character");
  });
});
