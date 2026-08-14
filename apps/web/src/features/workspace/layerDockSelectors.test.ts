import { describe, expect, it } from "vitest";
import type { Layer } from "../../types";
import { matchesLayerFilter } from "./layerDockSelectors";

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
        layer({ confidence: 72, fullContent: "نص منخفض الثقة" }),
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
        layer({ fullContent: "عنوان الفصل الأول" }),
        "الفصل",
        "all",
      ),
    ).toBe(true);
  });
});
