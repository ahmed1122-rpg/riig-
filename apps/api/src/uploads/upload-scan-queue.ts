import type { UploadSession } from "@motionprep/contracts";
import type { SourceVersionRepository } from "../sources/source-version-repository.js";
import type { UploadRepository } from "./upload-repository.js";
import { UploadOperationLock } from "./upload-operation-lock.js";

export interface QueueVerifiedUploadScanInput {
  session: UploadSession;
  sha256: string;
}

export interface UploadScanQueueCommand {
  enqueue(input: QueueVerifiedUploadScanInput): Promise<UploadSession>;
}

export class InMemoryUploadScanQueueCommand implements UploadScanQueueCommand {
  constructor(
    private readonly uploads: UploadRepository,
    private readonly sources: SourceVersionRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly operations = new UploadOperationLock(),
  ) {}

  async enqueue(input: QueueVerifiedUploadScanInput): Promise<UploadSession> {
    return this.operations.run(input.session.projectId, async () => {
      const current = await this.uploads.findById(input.session.uploadId);
      if (
        !current ||
        current.projectId !== input.session.projectId ||
        current.sourceVersionId !== input.session.sourceVersionId ||
        ["failed", "cancelled", "rejected", "scan_failed"].includes(
          current.status,
        )
      ) {
        throw new Error("Verified upload metadata no longer matches its session.");
      }
      if (!current.sourceVersionId) {
        throw new Error("Upload session is missing its source version.");
      }
      const scanning: UploadSession = {
        ...current,
        status: "scanning",
        sha256: input.sha256.toLowerCase(),
        malwareScanVerdict: "pending",
        updatedAt: this.now().toISOString(),
      };
      await this.uploads.save(scanning);
      await this.sources.update(current.sourceVersionId, {
        status: "scanning",
        sha256: scanning.sha256,
        malwareScanVerdict: "pending",
      });
      return scanning;
    });
  }
}
