// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { calculatePreviewFitZoom } from "./useExportPreviewZoom";

describe("calculatePreviewFitZoom", () => {
  it("measures the available stage instead of returning a fixed preset", () => {
    expect(calculatePreviewFitZoom(
      { width: 430, height: 330 },
      { width: 500, height: 400 },
    )).toBe(75);
    expect(calculatePreviewFitZoom(
      { width: 830, height: 630 },
      { width: 500, height: 400 },
    )).toBe(150);
  });

  it("clamps extreme values and ignores elements without measurable geometry", () => {
    expect(calculatePreviewFitZoom(
      { width: 200, height: 200 },
      { width: 2_000, height: 2_000 },
    )).toBe(30);
    expect(calculatePreviewFitZoom(
      { width: 2_000, height: 2_000 },
      { width: 100, height: 100 },
    )).toBe(160);
    expect(calculatePreviewFitZoom(
      { width: 0, height: 200 },
      { width: 100, height: 100 },
    )).toBeUndefined();
  });
});
