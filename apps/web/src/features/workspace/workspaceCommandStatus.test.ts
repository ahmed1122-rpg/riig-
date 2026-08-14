import { describe, expect, it } from "vitest";
import { workspaceCommandError } from "./workspaceCommandStatus";

describe("workspaceCommandError", () => {
  it("preserves an actionable command error without changing source state", () => {
    expect(
      workspaceCommandError(
        "دمج طبقات Raster",
        new Error("الطبقات ليست في المجموعة نفسها"),
        "تعذر تنفيذ الأمر",
      ),
    ).toEqual({
      phase: "error",
      label: "دمج طبقات Raster",
      message: "الطبقات ليست في المجموعة نفسها",
    });
  });

  it("uses the safe fallback for non-Error failures", () => {
    expect(workspaceCommandError("OCR إقليمي", null, "تعذر OCR")).toEqual({
      phase: "error",
      label: "OCR إقليمي",
      message: "تعذر OCR",
    });
  });
});
