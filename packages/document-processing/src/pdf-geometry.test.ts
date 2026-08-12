import { describe, expect, it } from "vitest";
import {
  assertPdfPageGeometry,
  assertRenderSurface,
  boundedOcrRenderScale,
} from "./pdf-geometry.js";

describe("PDF geometry guards", () => {
  it.each([
    [0, 100],
    [100, 0],
    [Number.NaN, 100],
    [30_001, 10],
    [20_000, 20_000],
  ])("rejects unsafe page geometry %s x %s", (width, height) => {
    expect(() => assertPdfPageGeometry(width, height, 7)).toThrow(
      expect.objectContaining({ code: "PDF_DECODE_FAILED", pageNumbers: [7] }),
    );
  });

  it("selects a bounded scale and validates the final integer surface", () => {
    const scale = boundedOcrRenderScale({
      width: 400,
      height: 300,
      pageNumber: 1,
      targetScale: 4,
      targetLongEdge: 1_600,
      maxScale: 4,
    });
    expect(scale).toBe(4);
    expect(() => assertRenderSurface(1_600, 1_200, 1)).not.toThrow();
  });

  it("rejects a render surface above the pixel budget", () => {
    expect(() => assertRenderSurface(6_000, 4_001, 3)).toThrow(
      expect.objectContaining({ code: "PDF_DECODE_FAILED", pageNumbers: [3] }),
    );
  });
});
