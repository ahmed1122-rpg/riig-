import type { UploadSession } from "@motionprep/contracts";
import {
  ObjectStorageIntegrityError,
  type ObjectStorage,
  type StoredObjectMetadata,
} from "../storage/object-storage.js";
import type { UploadIntegrityFailureCommand } from "./upload-integrity-failure.js";
import { classifyUploadIntegrityFailure } from "./upload-integrity.js";
import type { UploadRepository } from "./upload-repository.js";

export type FinalizationResolution =
  | { kind: "published"; session: UploadSession }
  | { kind: "not_published" }
  | { kind: "unknown" };

export async function resolveUploadFinalizationOutcome(input: {
  attempted: UploadSession;
  expectedSha256: string;
  uploads: UploadRepository;
  storage: ObjectStorage;
  integrityFailures?: UploadIntegrityFailureCommand;
  onObservationError?: (
    error: unknown,
    stage: "repository_read" | "storage_inspect" | "integrity_failure_record",
  ) => void;
}): Promise<FinalizationResolution> {
  let current: UploadSession | null;
  try {
    current = await input.uploads.findById(input.attempted.uploadId);
  } catch (error) {
    reportObservationError(input, error, "repository_read");
    return { kind: "unknown" };
  }
  if (
    !current ||
    current.projectId !== input.attempted.projectId ||
    current.sourceVersionId !== input.attempted.sourceVersionId
  ) {
    return { kind: "unknown" };
  }
  if (current.status === "ready") {
    if (
      current.sha256?.toLowerCase() !== input.expectedSha256.toLowerCase()
    ) {
      return { kind: "unknown" };
    }
    let stored: StoredObjectMetadata | null;
    try {
      stored = await input.storage.inspect(current.objectKey);
    } catch (error) {
      if (error instanceof ObjectStorageIntegrityError) {
        try {
          await input.integrityFailures?.markIntegrityFailure({
            session: current,
            code: "UPLOAD_OBJECT_METADATA_INVALID",
            observed: null,
          });
        } catch (recordError) {
          reportObservationError(
            input,
            recordError,
            "integrity_failure_record",
          );
        }
      }
      reportObservationError(input, error, "storage_inspect");
      return { kind: "unknown" };
    }
    const failureCode = classifyUploadIntegrityFailure(current, stored);
    if (!failureCode) return { kind: "published", session: current };
    try {
      await input.integrityFailures?.markIntegrityFailure({
        session: current,
        code: failureCode,
        observed: stored,
      });
    } catch (error) {
      reportObservationError(input, error, "integrity_failure_record");
    }
    return { kind: "unknown" };
  }
  if (current.status === "verifying") return { kind: "unknown" };
  return { kind: "not_published" };
}

function reportObservationError(
  input: {
    onObservationError?: (
      error: unknown,
      stage: "repository_read" | "storage_inspect" | "integrity_failure_record",
    ) => void;
  },
  error: unknown,
  stage: "repository_read" | "storage_inspect" | "integrity_failure_record",
): void {
  try {
    input.onObservationError?.(error, stage);
  } catch {
    // Recovery observers must never replace the original finalization error.
  }
}
