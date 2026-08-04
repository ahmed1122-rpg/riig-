import { describe, expect, it } from "vitest";
import {
  getActivityFailureMessage,
  getExportFailureMessage,
} from "./workflowFailurePresentation";

describe("workflow failure presentation", () => {
  it("classifies shared integrity and revision failures consistently", () => {
    expect(getExportFailureMessage("STORAGE_UNAVAILABLE")).toContain(
      "بأمان",
    );
    expect(
      getActivityFailureMessage({
        kind: "export",
        errorCode: "STORAGE_UNAVAILABLE",
      }),
    ).toContain("سلامة");
    expect(
      getActivityFailureMessage({
        kind: "processing",
        errorCode: "DOCUMENT_REVISION_CONFLICT",
      }),
    ).toContain("أحدث نسخة");
  });

  it("keeps domain-specific recovery guidance", () => {
    expect(getExportFailureMessage("EXPORT_PREFLIGHT_FAILED")).toContain(
      "مراجعة",
    );
    expect(
      getActivityFailureMessage({ kind: "upload", errorCode: null }),
    ).toContain("رفع المصدر");
    expect(
      getActivityFailureMessage({ kind: "review", errorCode: null }),
    ).toContain("تدخل");
  });
});
