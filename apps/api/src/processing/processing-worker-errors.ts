import { DocumentProcessingError } from "@motionprep/document-processing";
import { MediaProcessingError } from "@motionprep/media-processing";
import { z } from "zod";
import { PdfRegionOcrError } from "./pdf-region-ocr.js";

export class ProcessingWorkerError extends Error {
  constructor(
    readonly code:
      | "SOURCE_NOT_READY"
      | "SOURCE_INTEGRITY_FAILED"
      | "OCR_FAILED"
      | "INVALID_DOCUMENT_OPERATION"
      | "DOCUMENT_REVISION_CONFLICT",
  ) {
    super(code);
  }
}

export class ProcessingLeaseLostError extends Error {
  constructor() {
    super("Processing job lease was lost.");
  }
}

export function processingErrorCode(error: unknown): string {
  if (error instanceof DocumentProcessingError) return error.code;
  if (error instanceof PdfRegionOcrError) return error.code;
  if (error instanceof MediaProcessingError) return error.code;
  if (error instanceof ProcessingWorkerError) return error.code;
  if (error instanceof z.ZodError) return "INVALID_PROCESSING_OPTIONS";
  return "WORKER_FAILED";
}
