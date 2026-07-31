import { describe, expect, it } from "vitest";
import { getExportFormatPresentation } from "./exportPresentation";

describe("getExportFormatPresentation", () => {
  it("uses the real API identifiers for image export labels", () => {
    expect(getExportFormatPresentation("transparent-pngs").label).toBe(
      "PNG شفافة",
    );
    expect(getExportFormatPresentation("layered-tiff").label).toContain(
      "TIFF",
    );
  });

  it("explains the rasterized PSD behavior for PDF projects", () => {
    expect(getExportFormatPresentation("psd", "book").hint).toContain(
      "Raster",
    );
  });
});
