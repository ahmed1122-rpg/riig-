import { describe, expect, it } from "vitest";
import { UploadReconciliationMetrics } from "./upload-reconciliation-metrics.js";

describe("UploadReconciliationMetrics", () => {
  it("records bounded outcome and integrity labels", () => {
    const metrics = new UploadReconciliationMetrics(
      () => new Date("2026-08-03T12:00:00.000Z"),
    );
    metrics.observe({
      inspected: 4,
      repaired: 1,
      terminalFailed: 1,
      transientFailed: 1,
      stale: 1,
      failed: [
        {
          uploadId: "upload-1",
          code: "UPLOAD_HASH_MISMATCH",
          kind: "terminal",
        },
        {
          uploadId: "upload-2",
          code: "UPLOAD_STORAGE_INSPECTION_FAILED",
          kind: "transient",
        },
        {
          uploadId: "upload-3",
          code: "UPLOAD_RECONCILIATION_STALE",
          kind: "stale",
        },
      ],
    });

    const output = metrics.render().join("\n");
    expect(output).toContain(
      'motionprep_upload_reconciliation_outcomes_total{outcome="terminal"} 1',
    );
    expect(output).toContain(
      'motionprep_upload_integrity_terminal_total{reason="UPLOAD_HASH_MISMATCH"} 1',
    );
    expect(output).toContain(
      "motionprep_upload_reconciliation_last_success_timestamp_seconds 0",
    );
    expect(output).not.toContain("upload-1");
  });

  it("advances last success when a run has no transient failures", () => {
    const metrics = new UploadReconciliationMetrics(
      () => new Date("2026-08-03T12:00:00.000Z"),
    );
    metrics.observe({
      inspected: 0,
      repaired: 0,
      terminalFailed: 0,
      transientFailed: 0,
      stale: 0,
      failed: [],
    });

    expect(metrics.render().join("\n")).toContain(
      "motionprep_upload_reconciliation_last_success_timestamp_seconds 1785758400",
    );
  });
});
