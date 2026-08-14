import { DocumentProcessingError } from "@motionprep/document-processing";
import { describe, expect, it } from "vitest";
import { PdfRegionOcrError } from "./pdf-region-ocr.js";
import { safeProcessingDiagnostic } from "./processing-failure-diagnostic.js";

describe("safeProcessingDiagnostic", () => {
  it("returns bounded OCR metadata without the provider message", () => {
    const error = new DocumentProcessingError(
      "OCR_FAILED",
      "raw provider message must not be logged",
      [2],
      [{ pageNumber: 2, stage: "recognize", code: "engine-failed" }],
    );

    expect(safeProcessingDiagnostic(error)).toEqual({
      page_numbers: [2],
      failures: [
        {
          page_number: 2,
          stage: "recognize",
          code: "engine-failed",
        },
      ],
    });
  });

  it("omits an empty envelope for unrelated document failures", () => {
    expect(
      safeProcessingDiagnostic(
        new DocumentProcessingError("PDF_TOO_MANY_PAGES", "too many"),
      ),
    ).toBeNull();
  });

  it("normalizes regional OCR diagnostics", () => {
    expect(
      safeProcessingDiagnostic(
        new PdfRegionOcrError("OCR_FAILED", "failed", {
          pageNumber: 3,
          stage: "render",
          code: "render-failed",
        }),
      ),
    ).toEqual({
      page_numbers: [3],
      failures: [
        {
          page_number: 3,
          stage: "render",
          code: "render-failed",
        },
      ],
    });
  });
});
