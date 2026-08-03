export type DocumentProcessingErrorCode =
  | "PDF_DECODE_FAILED"
  | "PDF_TOO_MANY_PAGES"
  | "PDF_TEXT_LIMIT_EXCEEDED"
  | "OCR_REQUIRED"
  | "OCR_FAILED";

export class DocumentProcessingError extends Error {
  constructor(
    readonly code: DocumentProcessingErrorCode,
    message: string,
    readonly pageNumbers: number[] = [],
  ) {
    super(message);
  }
}
