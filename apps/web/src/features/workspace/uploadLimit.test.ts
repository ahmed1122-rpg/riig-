import { describe, expect, it } from "vitest";
import { uploadLimitLabel } from "./uploadLimit";

describe("uploadLimitLabel", () => {
  it("formats runtime limits without assuming the build-time maximum", () => {
    expect(uploadLimitLabel(30 * 1024 * 1024)).toBe("30 MiB");
    expect(uploadLimitLabel(1_500_000)).toBe("1.43 MiB");
  });

  it("reports an unavailable runtime limit explicitly", () => {
    expect(uploadLimitLabel(0)).toBe("غير متاح");
  });
});
