import { describe, expect, it } from "vitest";
import { unknownErrorMessage } from "./unknown-error.js";

describe("unknownErrorMessage", () => {
  it("preserves useful Error and string messages", () => {
    expect(unknownErrorMessage(new Error("database unavailable"))).toBe(
      "database unavailable",
    );
    expect(unknownErrorMessage("lease lost")).toBe("lease lost");
  });

  it("handles non-Error throws without creating another failure", () => {
    expect(unknownErrorMessage({ code: "BROKEN" })).toBe("[object Object]");
    expect(
      unknownErrorMessage(
        { toString: () => { throw new Error("toString failed"); } },
        "safe fallback",
      ),
    ).toBe("safe fallback");
  });
});
