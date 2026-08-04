import { uploadIntegrityFailureCodes } from "./upload-integrity-failure.js";
import type { UploadReconciliationReport } from "./upload-reconciler.js";

const outcomes = ["repaired", "terminal", "transient", "stale"] as const;
type ReconciliationOutcome = (typeof outcomes)[number];

export class UploadReconciliationMetrics {
  readonly #outcomes = new Map<ReconciliationOutcome, number>(
    outcomes.map((outcome) => [outcome, 0]),
  );
  readonly #integrityFailures = new Map<string, number>(
    uploadIntegrityFailureCodes.map((code) => [code, 0]),
  );
  #runs = 0;
  #lastRunTimestampSeconds = 0;
  #lastSuccessTimestampSeconds = 0;
  #lastInspected = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  observe(report: UploadReconciliationReport): void {
    this.#runs += 1;
    this.#lastRunTimestampSeconds = Math.floor(this.now().getTime() / 1_000);
    this.#lastInspected = report.inspected;
    this.increment("repaired", report.repaired);
    this.increment("terminal", report.terminalFailed);
    this.increment("transient", report.transientFailed);
    this.increment("stale", report.stale);
    if (report.transientFailed === 0) {
      this.#lastSuccessTimestampSeconds = this.#lastRunTimestampSeconds;
    }
    for (const failure of report.failed) {
      if (failure.kind !== "terminal") continue;
      this.#integrityFailures.set(
        failure.code,
        (this.#integrityFailures.get(failure.code) ?? 0) + 1,
      );
    }
  }

  render(): string[] {
    const lines = [
      "# HELP motionprep_upload_reconciliation_runs_total Completed upload reconciliation runs.",
      "# TYPE motionprep_upload_reconciliation_runs_total counter",
      `motionprep_upload_reconciliation_runs_total ${this.#runs}`,
      "# HELP motionprep_upload_reconciliation_outcomes_total Upload reconciliation outcomes.",
      "# TYPE motionprep_upload_reconciliation_outcomes_total counter",
    ];
    for (const outcome of outcomes) {
      lines.push(
        `motionprep_upload_reconciliation_outcomes_total{outcome="${outcome}"} ${this.#outcomes.get(outcome) ?? 0}`,
      );
    }
    lines.push(
      "# HELP motionprep_upload_integrity_terminal_total Uploads made terminal after a proven object-integrity failure.",
      "# TYPE motionprep_upload_integrity_terminal_total counter",
    );
    for (const code of uploadIntegrityFailureCodes) {
      lines.push(
        `motionprep_upload_integrity_terminal_total{reason="${code}"} ${this.#integrityFailures.get(code) ?? 0}`,
      );
    }
    lines.push(
      "# HELP motionprep_upload_reconciliation_last_run_timestamp_seconds Unix time of the latest upload reconciliation run.",
      "# TYPE motionprep_upload_reconciliation_last_run_timestamp_seconds gauge",
      `motionprep_upload_reconciliation_last_run_timestamp_seconds ${this.#lastRunTimestampSeconds}`,
      "# HELP motionprep_upload_reconciliation_last_success_timestamp_seconds Unix time of the latest upload reconciliation run without transient failures.",
      "# TYPE motionprep_upload_reconciliation_last_success_timestamp_seconds gauge",
      `motionprep_upload_reconciliation_last_success_timestamp_seconds ${this.#lastSuccessTimestampSeconds}`,
      "# HELP motionprep_upload_reconciliation_last_inspected Number of candidates inspected by the latest run.",
      "# TYPE motionprep_upload_reconciliation_last_inspected gauge",
      `motionprep_upload_reconciliation_last_inspected ${this.#lastInspected}`,
    );
    return lines;
  }

  private increment(outcome: ReconciliationOutcome, value: number): void {
    this.#outcomes.set(outcome, (this.#outcomes.get(outcome) ?? 0) + value);
  }
}
