import type { ObjectStorage } from "../storage/object-storage.js";
import type { UploadFinalizationCommand } from "./upload-finalization.js";

export interface UploadReconciliationReport {
  inspected: number;
  repaired: number;
  failed: Array<{ uploadId: string; code: string }>;
}

export class UploadReconciler {
  #timer: NodeJS.Timeout | null = null;
  #running: Promise<void> | null = null;
  #stopped = true;

  constructor(
    private readonly finalization: UploadFinalizationCommand,
    private readonly storage: ObjectStorage,
    private readonly onReport: (report: UploadReconciliationReport) => void =
      () => {},
    private readonly intervalMilliseconds = 60_000,
  ) {}

  async runOnce(limit = 100): Promise<UploadReconciliationReport> {
    const candidates = this.finalization.findCandidates
      ? await this.finalization.findCandidates(limit)
      : [];
    const report: UploadReconciliationReport = {
      inspected: candidates.length,
      repaired: 0,
      failed: [],
    };
    for (const session of candidates) {
      try {
        const stored = await this.storage.inspect(session.objectKey);
        if (
          !stored ||
          stored.contentType !== session.contentType ||
          stored.sizeBytes !== session.expectedSizeBytes
        ) {
          report.failed.push({
            uploadId: session.uploadId,
            code: "UPLOAD_STORAGE_MISMATCH",
          });
          continue;
        }
        if (session.sha256 && session.sha256 !== stored.sha256) {
          report.failed.push({
            uploadId: session.uploadId,
            code: "UPLOAD_HASH_MISMATCH",
          });
          continue;
        }
        await this.finalization.finalize({
          session,
          sha256: stored.sha256,
        });
        report.repaired += 1;
      } catch {
        report.failed.push({
          uploadId: session.uploadId,
          code: "UPLOAD_RECONCILIATION_FAILED",
        });
      }
    }
    this.onReport(report);
    return report;
  }

  start(): void {
    if (!this.#stopped || !this.finalization.findCandidates) return;
    this.#stopped = false;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    await this.#running;
  }

  private schedule(delay: number): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#running = this.runOnce()
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          this.#running = null;
          this.schedule(this.intervalMilliseconds);
        });
    }, delay);
    this.#timer.unref();
  }
}
