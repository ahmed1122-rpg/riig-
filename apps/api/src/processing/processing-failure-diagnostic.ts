import { DocumentProcessingError } from "@motionprep/document-processing";
import { PdfRegionOcrError } from "./pdf-region-ocr.js";

export interface SafeProcessingDiagnostic {
  page_numbers: number[];
  failures: Array<{
    page_number: number;
    stage: "render" | "recognize";
    code: "render-failed" | "engine-failed" | "empty-result";
  }>;
}

/**
 * Keeps operational OCR evidence useful without copying source text or raw
 * provider errors into logs. Non-OCR document failures deliberately produce
 * no diagnostic envelope.
 */
export function safeProcessingDiagnostic(
  error: unknown,
): SafeProcessingDiagnostic | null {
  if (error instanceof DocumentProcessingError) {
    if (error.pageNumbers.length === 0 && error.diagnostics.length === 0) {
      return null;
    }
    return {
      page_numbers: error.pageNumbers,
      failures: error.diagnostics.map((diagnostic) => ({
        page_number: diagnostic.pageNumber,
        stage: diagnostic.stage,
        code: diagnostic.code,
      })),
    };
  }
  if (error instanceof PdfRegionOcrError && error.diagnostic) {
    return {
      page_numbers: [error.diagnostic.pageNumber],
      failures: [
        {
          page_number: error.diagnostic.pageNumber,
          stage: error.diagnostic.stage,
          code: error.diagnostic.code,
        },
      ],
    };
  }
  return null;
}
