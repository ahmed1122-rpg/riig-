import { describe, expect, it } from "vitest";
import { processingJobOptionsSchema } from "./processing-job-options.js";

describe("processingJobOptionsSchema", () => {
  it("applies the documented separation default", () => {
    expect(processingJobOptionsSchema.parse({})).toEqual({
      pdfSeparationMode: "sentence",
    });
  });

  it("accepts a bounded regional OCR operation", () => {
    expect(
      processingJobOptionsSchema.parse({
        pdfSeparationMode: "word",
        pdfRegionOcr: {
          pageNumber: 2,
          start: { x: 0.1, y: 0.2 },
          end: { x: 0.8, y: 0.9 },
          baseRevision: 4,
          actorUserId: crypto.randomUUID(),
          operationId: "region-4",
        },
      }),
    ).toMatchObject({
      pdfSeparationMode: "word",
      pdfRegionOcr: { pageNumber: 2, baseRevision: 4 },
    });
  });

  it("rejects an out-of-bounds regional OCR operation", () => {
    expect(() =>
      processingJobOptionsSchema.parse({
        pdfRegionOcr: {
          pageNumber: 0,
          start: { x: -0.1, y: 0 },
          end: { x: 1.1, y: 1 },
          baseRevision: 0,
          actorUserId: "not-a-user",
          operationId: "",
        },
      }),
    ).toThrow();
  });
});
