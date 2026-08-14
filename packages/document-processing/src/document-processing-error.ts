export type DocumentProcessingErrorCode =
  | "PDF_DECODE_FAILED"
  | "PDF_TOO_MANY_PAGES"
  | "PDF_TEXT_LIMIT_EXCEEDED"
  | "OCR_REQUIRED"
  | "OCR_FAILED";

export interface DocumentProcessingDiagnostic {
  pageNumber: number;
  stage: "render" | "recognize";
  code: "render-failed" | "engine-failed" | "empty-result";
}

export class DocumentProcessingError extends Error {
  constructor(
    readonly code: DocumentProcessingErrorCode,
    message: string,
    readonly pageNumbers: number[] = [],
    readonly diagnostics: DocumentProcessingDiagnostic[] = [],
  ) {
    super(message);
  }
}
