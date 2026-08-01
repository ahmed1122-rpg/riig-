export type ProcessingDomainErrorCode =
  | "PROCESSING_NOT_FOUND"
  | "PROCESSING_IN_PROGRESS"
  | "SOURCE_NOT_CURRENT"
  | "SOURCE_NOT_READY"
  | "SOURCE_INTEGRITY_FAILED"
  | "DOCUMENT_NOT_FOUND"
  | "DOCUMENT_REVISION_CONFLICT"
  | "EDIT_HISTORY_UNAVAILABLE"
  | "INVALID_DOCUMENT_OPERATION"
  | "INVALID_LAYER_UPDATE"
  | "LAYER_ASSET_NOT_FOUND"
  | "LAYER_ASSET_INTEGRITY_FAILED"
  | "OCR_REQUIRED"
  | "OCR_FAILED"
  | "PDF_DECODE_FAILED"
  | "PDF_TOO_MANY_PAGES"
  | "PDF_TEXT_LIMIT_EXCEEDED"
  | "IMAGE_HAS_NO_VISIBLE_PIXELS"
  | "IMAGE_LAYER_LIMIT_EXCEEDED"
  | "GUIDANCE_INVALID"
  | "GUIDANCE_DUPLICATE"
  | "GUIDANCE_LAYER_UNAVAILABLE"
  | "PROCESSING_FAILED";

export class ProcessingDomainError extends Error {
  constructor(
    readonly code: ProcessingDomainErrorCode,
    message: string,
    readonly jobId?: string,
  ) {
    super(message);
  }
}

export function processingDomainCode(code: string): ProcessingDomainErrorCode {
  switch (code) {
    case "SOURCE_NOT_READY":
    case "SOURCE_INTEGRITY_FAILED":
    case "OCR_REQUIRED":
    case "OCR_FAILED":
    case "PDF_DECODE_FAILED":
    case "PDF_TOO_MANY_PAGES":
    case "PDF_TEXT_LIMIT_EXCEEDED":
    case "IMAGE_HAS_NO_VISIBLE_PIXELS":
    case "DOCUMENT_REVISION_CONFLICT":
    case "INVALID_DOCUMENT_OPERATION":
      return code;
    default:
      return "PROCESSING_FAILED";
  }
}
