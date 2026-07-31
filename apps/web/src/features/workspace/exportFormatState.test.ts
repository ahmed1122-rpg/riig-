import { describe, expect, it } from "vitest";
import { selectExportFormat, selectExportScope } from "./exportFormatState";

describe("selectExportFormat", () => {
  it("clears a prior success state when the user chooses another format", () => {
    expect(
      selectExportFormat(
        { format: "psd", generationState: "done" },
        "png-files",
      ),
    ).toEqual({
      format: "png-files",
      generationState: "idle",
    });
  });

  it("preserves state when the selected format does not change", () => {
    const current = { format: "psd", generationState: "done" } as const;
    expect(selectExportFormat(current, "psd")).toBe(current);
  });
});

describe("selectExportScope", () => {
  it("clears a prior success state when the PDF packaging changes", () => {
    expect(
      selectExportScope(
        { scope: "pages", generationState: "done" },
        "document",
      ),
    ).toEqual({
      scope: "document",
      generationState: "idle",
    });
  });

  it("preserves state when the PDF packaging does not change", () => {
    const current = { scope: "pages", generationState: "done" } as const;
    expect(selectExportScope(current, "pages")).toBe(current);
  });
});
