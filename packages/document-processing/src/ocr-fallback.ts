export interface OcrCandidateSummary {
  wordCount: number;
  averageConfidence: number;
  arabicCharacterRatio: number;
  contentCoverage: number;
}

export type OcrPreprocessing =
  | "normalize"
  | "threshold-190"
  | "sharpen"
  | "median"
  | "trim-sharpen";

export type OcrSegmentation =
  | "auto"
  | "single-column"
  | "single-block"
  | "sparse-text";

export interface OcrFallbackStrategy {
  preprocessing: OcrPreprocessing;
  segmentation: OcrSegmentation;
  latinOverlay?: true;
}

const MINIMUM_WORDS = 20;
const MINIMUM_CONFIDENCE = 0.4;
const HIGH_ARABIC_RATIO = 0.92;
const FRAGMENTED_ARABIC_RATIO = 0.9;
const DENSE_WORD_COUNT = 150;
const SPARSE_CONTENT_COVERAGE = 0.15;
const FRAGMENTED_CONTENT_COVERAGE = 0.25;
const HIGH_CONTENT_COVERAGE = 0.65;
const SHORT_PAGE_WORD_COUNT = 60;
const MEDIUM_PAGE_WORD_COUNT = 100;
const MIXED_SCRIPT_MINIMUM_WORDS = 100;
const MIXED_SCRIPT_MAXIMUM_CONFIDENCE = 0.45;
const MIXED_SCRIPT_MAXIMUM_ARABIC_RATIO = 0.85;
const MIXED_SCRIPT_MINIMUM_CONTENT_COVERAGE = 0.6;
const LOW_CONTRAST_MINIMUM_WORDS = 120;
const LOW_CONTRAST_MAXIMUM_WORDS = 200;
const LOW_CONTRAST_MINIMUM_CONFIDENCE = 0.4;
const LOW_CONTRAST_MAXIMUM_CONFIDENCE = 0.5;
const LOW_CONTRAST_MINIMUM_ARABIC_RATIO = 0.93;
const LOW_CONTRAST_MINIMUM_CONTENT_COVERAGE = 0.35;
const LOW_CONTRAST_MAXIMUM_CONTENT_COVERAGE = 0.5;

/**
 * Selects at most one fallback from observable OCR/layout properties. The
 * thresholds are guarded by source-isolated development/validation/holdout
 * benchmarks; sample identifiers are deliberately absent from the input.
 */
export function selectOcrFallback(
  candidate: OcrCandidateSummary,
): OcrFallbackStrategy | null {
  if (candidate.wordCount < MINIMUM_WORDS) {
    return {
      preprocessing: "normalize",
      segmentation: "sparse-text",
    };
  }
  if (
    candidate.wordCount >= MIXED_SCRIPT_MINIMUM_WORDS &&
    candidate.averageConfidence < MIXED_SCRIPT_MAXIMUM_CONFIDENCE &&
    candidate.arabicCharacterRatio < MIXED_SCRIPT_MAXIMUM_ARABIC_RATIO &&
    candidate.contentCoverage >= MIXED_SCRIPT_MINIMUM_CONTENT_COVERAGE
  ) {
    return {
      preprocessing: "normalize",
      segmentation: "auto",
      latinOverlay: true,
    };
  }
  if (
    candidate.wordCount >= LOW_CONTRAST_MINIMUM_WORDS &&
    candidate.wordCount < LOW_CONTRAST_MAXIMUM_WORDS &&
    candidate.averageConfidence >= LOW_CONTRAST_MINIMUM_CONFIDENCE &&
    candidate.averageConfidence < LOW_CONTRAST_MAXIMUM_CONFIDENCE &&
    candidate.arabicCharacterRatio >= LOW_CONTRAST_MINIMUM_ARABIC_RATIO &&
    candidate.contentCoverage >= LOW_CONTRAST_MINIMUM_CONTENT_COVERAGE &&
    candidate.contentCoverage <= LOW_CONTRAST_MAXIMUM_CONTENT_COVERAGE
  ) {
    return {
      preprocessing: "threshold-190",
      segmentation: "single-column",
    };
  }
  if (candidate.averageConfidence >= MINIMUM_CONFIDENCE) return null;

  if (
    candidate.wordCount >= DENSE_WORD_COUNT ||
    candidate.arabicCharacterRatio >= HIGH_ARABIC_RATIO ||
    (candidate.arabicCharacterRatio >= FRAGMENTED_ARABIC_RATIO &&
      candidate.contentCoverage >= HIGH_CONTENT_COVERAGE)
  ) {
    return {
      preprocessing: "normalize",
      segmentation: "single-block",
    };
  }
  if (
    candidate.wordCount < SHORT_PAGE_WORD_COUNT &&
    candidate.arabicCharacterRatio >= FRAGMENTED_ARABIC_RATIO &&
    candidate.contentCoverage >= FRAGMENTED_CONTENT_COVERAGE
  ) {
    return {
      preprocessing: "normalize",
      segmentation: "sparse-text",
    };
  }
  if (candidate.contentCoverage < SPARSE_CONTENT_COVERAGE) {
    return {
      preprocessing: "threshold-190",
      segmentation: "single-column",
    };
  }
  if (candidate.wordCount < SHORT_PAGE_WORD_COUNT) {
    return {
      preprocessing: "trim-sharpen",
      segmentation: "auto",
    };
  }
  if (candidate.wordCount < MEDIUM_PAGE_WORD_COUNT) {
    return {
      preprocessing: "threshold-190",
      segmentation: "sparse-text",
    };
  }
  return {
    preprocessing: "median",
    segmentation: "sparse-text",
  };
}
