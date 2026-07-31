import type {
  OcrPageReview,
  OcrReviewReason,
} from "@motionprep/contracts";
import type { OcrCandidateSummary } from "./ocr-fallback.js";

export const OCR_REVIEW_POLICY_VERSION = "1.0" as const;
export const OCR_REVIEW_MINIMUM_CONFIDENCE = 0.35;

/**
 * Flags uncertain OCR without discarding recognized text or weakening the
 * accuracy benchmark. The threshold is based only on the engine's final,
 * observable output and deliberately receives no source or fixture identity.
 */
export function evaluateOcrPageReview(
  pageNumber: number,
  candidate: OcrCandidateSummary,
  fallbackUsed: boolean,
): OcrPageReview | null {
  const reasons: OcrReviewReason[] = [];
  if (candidate.averageConfidence < OCR_REVIEW_MINIMUM_CONFIDENCE) {
    reasons.push("low_confidence");
  }
  if (reasons.length === 0) return null;
  return {
    pageNumber,
    status: "needs_review",
    reasons,
    wordCount: candidate.wordCount,
    averageConfidence: round(candidate.averageConfidence),
    arabicCharacterRatio: round(candidate.arabicCharacterRatio),
    contentCoverage: round(candidate.contentCoverage),
    fallbackUsed,
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
