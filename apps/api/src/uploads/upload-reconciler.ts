import {
  ObjectStorageIntegrityError,
  type ObjectStorage,
  type StoredObjectMetadata,
} from "../storage/object-storage.js";
import type { UploadFinalizationCommand } from "./upload-finalization.js";
import type {
  UploadIntegrityFailureCode,
  UploadIntegrityFailureCommand,
} from "./upload-integrity-failure.js";
import { classifyUploadIntegrityFailure } from "./upload-integrity.js";

type UploadReconciliationFailureKind =
  | "terminal"
  | "transient"
  | "stale";

interface UploadReconciliationFailure {
  uploadId: string | null;
  code: string;
  kind: UploadReconciliationFailureKind;
}

export interface UploadReconciliationReport {
  inspected: number;
  repaired: number;
  terminalFailed: number;
  transientFailed: number;
  stale: number;
  failed: UploadReconciliationFailure[];
}

export class UploadReconciler {
  #timer: NodeJS.Timeout | null = null;
  #running: Promise<void> | null = null;
  #stopped = true;

  constructor(
    private readonly finalization: UploadFinalizationCommand,
    private readonly integrityFailures: UploadIntegrityFailureCommand,
    private readonly storage: ObjectStorage,
    private readonly onReport: (report: UploadReconciliationReport) => void =
      () => {},
    private readonly intervalMilliseconds = 60_000,
    private readonly onCycleError: (error: unknown) => void = () => {},
  ) {}

  async runOnce(limit = 100): Promise<UploadReconciliationReport> {
    const report = emptyReport();
    let candidates;
    try {
      candidates = this.finalization.findCandidates
        ? await this.finalization.findCandidates(limit)
        : [];
    } catch {
      recordFailure(report, {
        uploadId: null,
        code: "UPLOAD_CANDIDATE_DISCOVERY_FAILED",
        kind: "transient",
      });
      this.onReport(report);
      return report;
    }
    report.inspected = candidates.length;
    for (const session of candidates) {
      let stored: StoredObjectMetadata | null;
      try {
        stored = await this.storage.inspect(session.objectKey);
      } catch (error) {
        if (error instanceof ObjectStorageIntegrityError) {
          await this.markTerminal(
            report,
            session,
            "UPLOAD_OBJECT_METADATA_INVALID",
            null,
          );
        } else {
          recordFailure(report, {
            uploadId: session.uploadId,
            code: "UPLOAD_STORAGE_INSPECTION_FAILED",
            kind: "transient",
          });
        }
        continue;
      }

      const failureCode = classifyUploadIntegrityFailure(session, stored);
      if (failureCode) {
        await this.markTerminal(report, session, failureCode, stored);
        continue;
      }

      try {
        await this.finalization.finalize({
          session,
          sha256: stored!.sha256,
        });
        report.repaired += 1;
      } catch {
        recordFailure(report, {
          uploadId: session.uploadId,
          code: "UPLOAD_RECONCILIATION_FAILED",
          kind: "transient",
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

  private async markTerminal(
    report: UploadReconciliationReport,
    session: Parameters<UploadFinalizationCommand["finalize"]>[0]["session"],
    code: UploadIntegrityFailureCode,
    observed: StoredObjectMetadata | null,
  ): Promise<void> {
    try {
      const result = await this.integrityFailures.markIntegrityFailure({
        session,
        code,
        observed,
      });
      if (result.outcome === "transitioned") {
        recordFailure(report, {
          uploadId: session.uploadId,
          code,
          kind: "terminal",
        });
        return;
      }
      recordFailure(report, {
        uploadId: session.uploadId,
        code: "UPLOAD_RECONCILIATION_STALE",
        kind: "stale",
      });
    } catch {
      recordFailure(report, {
        uploadId: session.uploadId,
        code: "UPLOAD_INTEGRITY_TRANSITION_FAILED",
        kind: "transient",
      });
    }
  }

  private schedule(delay: number): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#running = this.runOnce()
        .then(() => undefined)
        .catch((error: unknown) => this.reportCycleError(error))
        .finally(() => {
          this.#running = null;
          this.schedule(this.intervalMilliseconds);
        });
    }, delay);
    this.#timer.unref();
  }

  private reportCycleError(error: unknown): void {
    try {
      this.onCycleError(error);
    } catch {
      // Reconciliation scheduling must survive an observability sink failure.
    }
  }
}

function emptyReport(): UploadReconciliationReport {
  return {
    inspected: 0,
    repaired: 0,
    terminalFailed: 0,
    transientFailed: 0,
    stale: 0,
    failed: [],
  };
}

function recordFailure(
  report: UploadReconciliationReport,
  failure: UploadReconciliationFailure,
): void {
  report.failed.push(failure);
  if (failure.kind === "terminal") report.terminalFailed += 1;
  if (failure.kind === "transient") report.transientFailed += 1;
  if (failure.kind === "stale") report.stale += 1;
}
