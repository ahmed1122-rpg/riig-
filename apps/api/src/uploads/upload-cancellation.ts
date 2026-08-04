import type {
  ProjectStatus,
  UploadSession,
} from "@motionprep/contracts";
import type { ProjectRepository } from "../projects/project-repository.js";
import type { SourceVersionRepository } from "../sources/source-version-repository.js";
import type { UploadOperationLock } from "./upload-operation-lock.js";
import { UploadOperationLock as DefaultUploadOperationLock } from "./upload-operation-lock.js";
import type { UploadRepository } from "./upload-repository.js";

export interface CancelUploadInput {
  session: UploadSession;
}

export type CancelUploadResult =
  | {
      outcome: "cancelled" | "already_cancelled";
      session: UploadSession;
    }
  | { outcome: "already_published"; session: UploadSession }
  | { outcome: "stale_session" };

/**
 * Converges upload, source, and project metadata before object deletion.
 * Durable implementations must serialize this transition with finalization.
 */
export interface UploadCancellationCommand {
  cancel(input: CancelUploadInput): Promise<CancelUploadResult>;
}

export class InMemoryUploadCancellationCommand
  implements UploadCancellationCommand
{
  constructor(
    private readonly uploads: UploadRepository,
    private readonly sourceVersions: SourceVersionRepository,
    private readonly projects: ProjectRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly uploadOperations: UploadOperationLock =
      new DefaultUploadOperationLock(),
  ) {}

  async cancel(input: CancelUploadInput): Promise<CancelUploadResult> {
    return this.uploadOperations.run(input.session.projectId, async () => {
      const current = await this.uploads.findById(input.session.uploadId);
      if (!current || !matchesIdentity(current, input.session)) {
        return { outcome: "stale_session" };
      }
      if (current.status === "ready") {
        return { outcome: "already_published", session: current };
      }

      const alreadyCancelled = current.status === "cancelled";
      const cancelled: UploadSession = alreadyCancelled
        ? current
        : {
            ...current,
            status: "cancelled",
            updatedAt: this.now().toISOString(),
          };
      if (!alreadyCancelled) await this.uploads.save(cancelled);

      if (cancelled.sourceVersionId) {
        const source = await this.sourceVersions.findById(
          cancelled.sourceVersionId,
        );
        if (
          source &&
          source.projectId === cancelled.projectId &&
          source.uploadId === cancelled.uploadId &&
          source.status !== "cancelled"
        ) {
          await this.sourceVersions.update(source.id, {
            status: "cancelled",
          });
        }
        await this.restoreProjectStatus(cancelled);
      }

      return {
        outcome: alreadyCancelled ? "already_cancelled" : "cancelled",
        session: cancelled,
      };
    });
  }

  private async restoreProjectStatus(
    session: UploadSession,
  ): Promise<void> {
    if (!session.sourceVersionId) return;
    const otherActive = await this.uploads.findActiveByProject(
      session.projectId,
    );
    if (otherActive && otherActive.uploadId !== session.uploadId) return;
    const project = await this.projects.findById(session.projectId);
    if (!project || !["validating", "uploading"].includes(project.status)) {
      return;
    }
    const baseline =
      (await this.uploads.findProjectStatusBeforeUpload(session.uploadId)) ??
      fallbackProjectStatus(project.currentSourceVersionId);
    await this.projects.settleUploadCancellation(
      session.projectId,
      session.sourceVersionId,
      baseline,
    );
  }
}

function fallbackProjectStatus(
  currentSourceVersionId: string | null,
): ProjectStatus {
  return currentSourceVersionId ? "needs_review" : "draft";
}

function matchesIdentity(
  current: UploadSession,
  expected: UploadSession,
): boolean {
  return (
    current.projectId === expected.projectId &&
    current.sourceVersionId === expected.sourceVersionId
  );
}
