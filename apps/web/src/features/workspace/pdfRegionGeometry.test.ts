import { describe, expect, it } from "vitest";
import {
  createPdfRegionFromPercent,
  hasValidPdfRegionGeometry,
  normalizePdfRegionOrders,
} from "./pdfRegionGeometry";

describe("PDF region geometry", () => {
  it("rejects zero-width and overflowing keyboard regions", () => {
    expect(
      createPdfRegionFromPercent(
        { x: 100, y: 10, width: 50, height: 10 },
        "line",
      ),
    ).toMatchObject({ valid: false });
    expect(
      createPdfRegionFromPercent(
        { x: 75, y: 10, width: 50, height: 10 },
        "line",
      ),
    ).toMatchObject({ valid: false });
  });

  it("creates a visible normalized region inside the page", () => {
    expect(
      createPdfRegionFromPercent(
        { x: 25, y: 10, width: 50, height: 15 },
        "heading",
      ),
    ).toEqual({
      valid: true,
      region: {
        x: 0.25,
        y: 0.1,
        width: 0.5,
        height: 0.15,
        label: "heading",
      },
    });
  });

  it("normalizes reading order while keeping exclusions unordered", () => {
    const regions = normalizePdfRegionOrders([
      { id: "a", x: 0, y: 0, width: 0.2, height: 0.1, label: "line", order: 7 },
      { id: "b", x: 0, y: 0.2, width: 0.2, height: 0.1, label: "exclude", order: 8 },
      { id: "c", x: 0, y: 0.4, width: 0.2, height: 0.1, label: "topic", order: 9 },
    ]);
    expect(regions.map((region) => region.order)).toEqual([1, null, 2]);
    expect(hasValidPdfRegionGeometry(regions[0]!)).toBe(true);
  });
});
