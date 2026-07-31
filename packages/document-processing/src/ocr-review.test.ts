import { describe, expect, it } from "vitest";
import {
  evaluateOcrPageReview,
  OCR_REVIEW_MINIMUM_CONFIDENCE,
} from "./ocr-review.js";

describe("OCR review policy", () => {
  it("flags low-confidence output while preserving its observable evidence", () => {
    expect(
      evaluateOcrPageReview(
        2,
        {
          wordCount: 174,
          averageConfidence: 0.30136,
          arabicCharacterRatio: 0.97,
          contentCoverage: 0.72,
        },
        true,
      ),
    ).toEqual({
      pageNumber: 2,
      status: "needs_review",
      reasons: ["low_confidence"],
      wordCount: 174,
      averageConfidence: 0.3014,
      arabicCharacterRatio: 0.97,
      contentCoverage: 0.72,
      fallbackUsed: true,
    });
  });

  it("does not flag output at the accepted confidence boundary", () => {
    expect(
      evaluateOcrPageReview(
        1,
        {
          wordCount: 20,
          averageConfidence: OCR_REVIEW_MINIMUM_CONFIDENCE,
          arabicCharacterRatio: 0.9,
          contentCoverage: 0.5,
        },
        false,
      ),
    ).toBeNull();
  });
});
