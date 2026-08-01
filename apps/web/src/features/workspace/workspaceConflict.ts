import { ApiError } from "../../lib/api";

const revisionConflictCodes = new Set([
  "DOCUMENT_REVISION_CONFLICT",
  "EXPORT_DOCUMENT_REVISION_CONFLICT",
]);

export function isWorkspaceRevisionConflict(
  error: unknown,
): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    revisionConflictCodes.has(error.code)
  );
}
