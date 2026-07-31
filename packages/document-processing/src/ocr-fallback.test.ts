import { describe, expect, it } from "vitest";
import {
  selectOcrFallback,
  type OcrCandidateSummary,
} from "./ocr-fallback.js";

const baseline: OcrCandidateSummary = {
  wordCount: 120,
  averageConfidence: 0.6,
  arabicCharacterRatio: 0.9,
  contentCoverage: 0.5,
};

describe("selectOcrFallback", () => {
  it("uses sparse text when automatic segmentation returns too few words", () => {
    expect(
      selectOcrFallback({ ...baseline, wordCount: 19 }),
    ).toEqual({
      preprocessing: "normalize",
      segmentation: "sparse-text",
    });
  });

  it("does not add a pass at the accepted confidence boundary", () => {
    expect(
      selectOcrFallback({
        ...baseline,
        averageConfidence: 0.4,
      }),
    ).toBeNull();
  });

  it("recovers low-contrast dense Arabic print with a column threshold", () => {
    expect(
      selectOcrFallback({
        wordCount: 128,
        averageConfidence: 0.4519,
        arabicCharacterRatio: 0.9375,
        contentCoverage: 0.4501,
      }),
    ).toEqual({
      preprocessing: "threshold-190",
      segmentation: "single-column",
    });
  });

  it.each([
    { wordCount: 119 },
    { wordCount: 200 },
    { averageConfidence: 0.5 },
    { arabicCharacterRatio: 0.9299 },
    { contentCoverage: 0.5001 },
  ])("does not over-apply the low-contrast print fallback: %o", (change) => {
    expect(
      selectOcrFallback({
        wordCount: 153,
        averageConfidence: 0.4844,
        arabicCharacterRatio: 0.9438,
        contentCoverage: 0.4297,
        ...change,
      }),
    ).toBeNull();
  });

  it.each([
    [
      "dense text",
      { wordCount: 150 },
      { preprocessing: "normalize", segmentation: "single-block" },
    ],
    [
      "strong Arabic coverage",
      { wordCount: 52, arabicCharacterRatio: 0.92 },
      { preprocessing: "normalize", segmentation: "single-block" },
    ],
    [
      "high-coverage Arabic manuscript",
      {
        wordCount: 61,
        arabicCharacterRatio: 0.91,
        contentCoverage: 0.67,
      },
      { preprocessing: "normalize", segmentation: "single-block" },
    ],
    [
      "sparse page coverage",
      { wordCount: 46, contentCoverage: 0.149 },
      {
        preprocessing: "threshold-190",
        segmentation: "single-column",
      },
    ],
    [
      "fragmented Arabic layout",
      {
        wordCount: 54,
        arabicCharacterRatio: 0.91,
        contentCoverage: 0.3,
      },
      { preprocessing: "normalize", segmentation: "sparse-text" },
    ],
    [
      "short decorated page",
      { wordCount: 59, arabicCharacterRatio: 0.85 },
      { preprocessing: "trim-sharpen", segmentation: "auto" },
    ],
    [
      "dense mixed-script page",
      {
        wordCount: 129,
        averageConfidence: 0.41,
        arabicCharacterRatio: 0.8,
        contentCoverage: 0.66,
      },
      {
        preprocessing: "normalize",
        segmentation: "auto",
        latinOverlay: true,
      },
    ],
    [
      "medium sparse page",
      { wordCount: 99 },
      {
        preprocessing: "threshold-190",
        segmentation: "sparse-text",
      },
    ],
    [
      "long sparse page",
      { wordCount: 100 },
      { preprocessing: "median", segmentation: "sparse-text" },
    ],
  ] as const)(
    "selects the bounded strategy for %s",
    (_name, input, expected) => {
      expect(
        selectOcrFallback({
          ...baseline,
          averageConfidence: 0.39,
          ...input,
        }),
      ).toEqual(expected);
    },
  );
});
