import type { UploadSession } from "@motionprep/contracts";
import type { ProjectRepository } from "../projects/project-repository.js";
import type { SourceVersionRepository } from "../sources/source-version-repository.js";
import type { StoredObjectMetadata } from "../storage/object-storage.js";
import type { UploadRepository } from "./upload-repository.js";
import { UploadOperationLock } from "./upload-operation-lock.js";

export const uploadIntegrityFailureCodes = [
  "UPLOAD_OBJECT_MISSING",
  "UPLOAD_OBJECT_METADATA_INVALID",
  "UPLOAD_CONTENT_TYPE_MISMATCH",
  "UPLOAD_SIZE_MISMATCH",
  "UPLOAD_HASH_MISMATCH",
] as const;

export type UploadIntegrityFailureCode =
  (typeof uploadIntegrityFailureCodes)[number];

export interface MarkUploadIntegrityFailureInput {
  session: UploadSession;
  code: UploadIntegrityFailureCode;
  observed: StoredObjectMetadata | null;
}

export type MarkUploadIntegrityFailureResult =
  | { outcome: "transitioned" }
  | { outcome: "already_terminal" }
  | { outcome: "stale_candidate" };

/**
 * Makes a proven object-integrity failure terminal in durable metadata.
 * Implementations must use the supplied session as an optimistic state fence:
 * a stale observation must never invalidate a newer upload transition.
 */
export interface UploadIntegrityFailureCommand {
  markIntegrityFailure(
    input: MarkUploadIntegrityFailureInput,
  ): Promise<MarkUploadIntegrityFailureResult>;
}

export class InMemoryUploadIntegrityFailureCommand
  implements UploadIntegrityFailureCommand
{
  constructor(
    private readonly uploads: UploadRepository,
    private readonly sourceVersions: SourceVersionRepository,
    private readonly projects: ProjectRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly uploadOperations = new UploadOperationLock(),
  ) {}

  async markIntegrityFailure(
    input: MarkUploadIntegrityFailureInput,
  ): Promise<MarkUploadIntegrityFailureResult> {
    return this.uploadOperations.run(input.session.projectId, async () => {
      const current = await this.uploads.findById(input.session.uploadId);
      if (!current || !matchesIdentity(current, input.session)) {
        return { outcome: "stale_candidate" };
      }
      if (["failed", "cancelled"].includes(current.status)) {
        return { outcome: "already_terminal" };
      }
      if (!matchesObservation(current, input.session)) {
        return { outcome: "stale_candidate" };
      }
      if (!["verifying", "ready"].includes(current.status)) {
        return { outcome: "stale_candidate" };
      }

      await this.uploads.save({
        ...current,
        status: "failed",
        updatedAt: this.now().toISOString(),
      });
      if (current.sourceVersionId) {
        await this.sourceVersions.update(current.sourceVersionId, {
          status: "failed",
        });
        // This guarded update is intentionally a no-op for historical sources.
        // The PostgreSQL implementation additionally fences and terminates an
        // active job in the same transaction.
        await this.projects.updateStatusForSource(
          current.projectId,
          current.sourceVersionId,
          "failed",
          null,
        );
      }
      return { outcome: "transitioned" };
    });
  }
}

function matchesObservation(
  current: UploadSession,
  observed: UploadSession,
): boolean {
  return (
    current.status === observed.status &&
    normalizedHash(current.sha256) === normalizedHash(observed.sha256)
  );
}

function matchesIdentity(
  current: UploadSession,
  observed: UploadSession,
): boolean {
  return (
    current.projectId === observed.projectId &&
    current.sourceVersionId === observed.sourceVersionId
  );
}

function normalizedHash(value: string | null): string | null {
  return value?.toLowerCase() ?? null;
}
