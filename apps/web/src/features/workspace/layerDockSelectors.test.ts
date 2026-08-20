import { describe, expect, it } from "vitest";
import type { Layer } from "../../types";
import {
  duplicateLayerIds,
  matchesLayerFilter,
} from "./layerDockSelectors";

function layer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: "text-1",
    name: "+line_001",
    kind: "text",
    visible: true,
    locked: false,
    opacity: 100,
    color: "#2563eb",
    pageNumber: 1,
    ...overrides,
  };
}

describe("matchesLayerFilter", () => {
  it("applies the low-confidence filter to PDF text layers", () => {
    expect(
      matchesLayerFilter(
        layer({ confidence: 72, fullText: "نص منخفض الثقة" }),
        "",
        "low-confidence",
      ),
    ).toBe(true);
    expect(
      matchesLayerFilter(layer({ confidence: 94 }), "", "low-confidence"),
    ).toBe(false);
  });

  it("searches extracted PDF text as well as layer names", () => {
    expect(
      matchesLayerFilter(
        layer({ fullText: "عنوان الفصل الأول" }),
        "الفصل",
        "all",
      ),
    ).toBe(true);
  });
});

describe("duplicateLayerIds", () => {
  it("scopes duplicate names to their parent folder", () => {
    const layers = [
      layer({ id: "first", parentId: "folder-a" }),
      layer({ id: "second", parentId: "folder-b" }),
      layer({ id: "third", parentId: "folder-a" }),
    ];

    expect([...duplicateLayerIds(layers, true)]).toEqual(["first", "third"]);
  });

  it("keeps page folders as an additional document scope", () => {
    const layers = [
      layer({ id: "page-one", parentId: "shared", pageNumber: 1 }),
      layer({ id: "page-two", parentId: "shared", pageNumber: 2 }),
    ];

    expect([...duplicateLayerIds(layers, true)]).toEqual([]);
    expect([...duplicateLayerIds(layers, false)]).toEqual([
      "page-one",
      "page-two",
    ]);
  });

  it("does not confuse delimiters inside parent IDs and layer names", () => {
    const layers = [
      layer({ id: "first", parentId: "folder:+a", name: "+b" }),
      layer({ id: "second", parentId: "folder", name: "+a:+b" }),
    ];

    expect([...duplicateLayerIds(layers, false)]).toEqual([]);
  });
});
