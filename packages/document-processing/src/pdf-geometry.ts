import { DocumentProcessingError } from "./document-processing-error.js";

const OCR_MAX_RENDER_PIXELS = 24_000_000;
const OCR_MIN_RENDER_SCALE = 0.25;
const MAX_PDF_PAGE_DIMENSION = 30_000;
const MAX_PDF_PAGE_AREA = 100_000_000;

export function assertPdfPageGeometry(
  width: number,
  height: number,
  pageNumber: number,
): void {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_PDF_PAGE_DIMENSION ||
    height > MAX_PDF_PAGE_DIMENSION ||
    width * height > MAX_PDF_PAGE_AREA
  ) {
    throw new DocumentProcessingError(
      "PDF_DECODE_FAILED",
      "The PDF page dimensions exceed the safe processing limits.",
      [pageNumber],
    );
  }
}

export function boundedOcrRenderScale(input: {
  width: number;
  height: number;
  pageNumber: number;
  targetScale: number;
  targetLongEdge: number;
  maxScale: number;
}): number {
  assertPdfPageGeometry(input.width, input.height, input.pageNumber);
  const pixels = input.width * input.height;
  if (pixels * OCR_MIN_RENDER_SCALE ** 2 > OCR_MAX_RENDER_PIXELS) {
    throw new DocumentProcessingError(
      "PDF_DECODE_FAILED",
      "The PDF page cannot be rendered within the OCR pixel budget.",
      [input.pageNumber],
    );
  }
  const safePixelScale = Math.sqrt(OCR_MAX_RENDER_PIXELS / pixels);
  const targetLongEdgeScale =
    input.targetLongEdge / Math.max(input.width, input.height);
  return Math.max(
    OCR_MIN_RENDER_SCALE,
    Math.min(
      input.targetScale,
      targetLongEdgeScale,
      safePixelScale,
      input.maxScale,
    ),
  );
}

export function assertRenderSurface(
  width: number,
  height: number,
  pageNumber: number,
): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > OCR_MAX_RENDER_PIXELS
  ) {
    throw new DocumentProcessingError(
      "PDF_DECODE_FAILED",
      "The requested PDF raster exceeds the safe OCR pixel budget.",
      [pageNumber],
    );
  }
}
