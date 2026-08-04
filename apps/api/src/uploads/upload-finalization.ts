import type { UploadSession } from "@motionprep/contracts";
import type { ProjectRepository } from "../projects/project-repository.js";
import type { SourceVersionRepository } from "../sources/source-version-repository.js";
import type { UploadRepository } from "./upload-repository.js";
import { UploadOperationLock } from "./upload-operation-lock.js";

export interface FinalizeVerifiedUploadInput {
  session: UploadSession;
  sha256: string;
}

/**
 * Publishes verified upload metadata as one logical state transition.
 * Durable implementations must make the upload, source-version, and project
 * writes atomic. The object itself is verified before this command is called.
 */
export interface UploadFinalizationCommand {
  finalize(input: FinalizeVerifiedUploadInput): Promise<UploadSession>;
  findCandidates?(limit: number): Promise<UploadSession[]>;
}

export class InMemoryUploadFinalizationCommand
  implements UploadFinalizationCommand
{
  readonly #publishedUploadIds = new Set<string>();

  constructor(
    private readonly uploads: UploadRepository,
    private readonly sourceVersions: SourceVersionRepository,
    private readonly projects: ProjectRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly uploadOperations = new UploadOperationLock(),
  ) {}

  async finalize(
    input: FinalizeVerifiedUploadInput,
  ): Promise<UploadSession> {
    return this.uploadOperations.run(input.session.projectId, async () => {
      const current = await this.requireMatchingUpload(input.session);
      const source = await this.requireMatchingSource(current);
      if (this.#publishedUploadIds.has(current.uploadId)) {
        if (current.sha256?.toLowerCase() !== input.sha256.toLowerCase()) {
          throw new Error("Published upload checksum cannot be changed.");
        }
        return current;
      }
      const ready: UploadSession = {
        ...current,
        status: "ready",
        sha256: input.sha256.toLowerCase(),
        updatedAt: this.now().toISOString(),
      };

      await this.uploads.save(ready);
      await this.sourceVersions.update(source.id, {
        status: "ready",
        sha256: ready.sha256,
      });
      await this.projects.updateCurrentSourceVersion(
        ready.projectId,
        source.id,
        source.versionNumber,
      );
      await this.projects.updateStatus(ready.projectId, "queued");
      this.#publishedUploadIds.add(ready.uploadId);
      return ready;
    });
  }

  private async requireMatchingUpload(
    expected: UploadSession,
  ): Promise<UploadSession> {
    const current = await this.uploads.findById(expected.uploadId);
    if (
      !current ||
      current.projectId !== expected.projectId ||
      current.sourceVersionId !== expected.sourceVersionId ||
      ["failed", "cancelled"].includes(current.status)
    ) {
      throw new Error("Verified upload metadata no longer matches its session.");
    }
    return current;
  }

  private async requireMatchingSource(session: UploadSession) {
    if (!session.sourceVersionId) {
      throw new Error("Upload session is missing its source version.");
    }
    const source = await this.sourceVersions.findById(session.sourceVersionId);
    if (
      !source ||
      source.projectId !== session.projectId ||
      source.uploadId !== session.uploadId
    ) {
      throw new Error("Upload source version does not match its session.");
    }
    return source;
  }
}
