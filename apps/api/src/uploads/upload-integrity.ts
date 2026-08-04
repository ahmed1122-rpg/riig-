import type { UploadSession } from "@motionprep/contracts";
import type { StoredObjectMetadata } from "../storage/object-storage.js";
import type { UploadIntegrityFailureCode } from "./upload-integrity-failure.js";

export function classifyUploadIntegrityFailure(
  session: UploadSession,
  stored: StoredObjectMetadata | null,
): UploadIntegrityFailureCode | null {
  if (!stored) return "UPLOAD_OBJECT_MISSING";
  if (stored.contentType !== session.contentType) {
    return "UPLOAD_CONTENT_TYPE_MISMATCH";
  }
  if (stored.sizeBytes !== session.expectedSizeBytes) {
    return "UPLOAD_SIZE_MISMATCH";
  }
  if (
    session.sha256 &&
    session.sha256.toLowerCase() !== stored.sha256.toLowerCase()
  ) {
    return "UPLOAD_HASH_MISMATCH";
  }
  return null;
}
