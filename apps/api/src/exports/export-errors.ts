export type ExportDomainErrorCode =
  | "EXPORT_NOT_FOUND"
  | "EXPORT_FORMAT_UNSUPPORTED"
  | "EXPORT_OPTION_UNSUPPORTED"
  | "EXPORT_SCOPE_UNSUPPORTED"
  | "EXPORT_NOT_CANCELLABLE"
  | "EXPORT_SOURCE_NOT_READY"
  | "EXPORT_SOURCE_NOT_CURRENT"
  | "EXPORT_SOURCE_INTEGRITY_FAILED"
  | "EXPORT_ARTIFACT_NOT_READY"
  | "EXPORT_ARTIFACT_INTEGRITY_FAILED"
  | "EXPORT_DOCUMENT_NOT_READY"
  | "EXPORT_DOCUMENT_REVISION_CONFLICT"
  | "EXPORT_PREFLIGHT_FAILED"
  | "EXPORT_DEADLINE_EXCEEDED"
  | "REVIEW_APPROVAL_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "EXPORT_REQUEST_IN_PROGRESS";

export class ExportDomainError extends Error {
  constructor(
    readonly code: ExportDomainErrorCode,
    message: string,
    readonly jobId?: string,
  ) {
    super(message);
  }
}

export class ExportExecutionError extends Error {
  constructor(
    message: string,
    readonly jobId: string,
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}
