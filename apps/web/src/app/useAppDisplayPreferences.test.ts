import { describe, expect, it, vi } from "vitest";
import {
  readStoredLightTheme,
  readStoredReducedMotion,
} from "./useAppDisplayPreferences";

describe("application display preferences", () => {
  it("reads explicit theme and reduced-motion preferences safely", () => {
    const storage = {
      getItem: vi.fn((key: string) =>
        key.includes("light-theme") ? "false" : "true",
      ),
    };
    expect(readStoredLightTheme(storage)).toBe(false);
    expect(readStoredReducedMotion(storage)).toBe(true);
  });

  it("uses reversible defaults when storage is unavailable or malformed", () => {
    expect(
      readStoredLightTheme({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe(true);
    expect(
      readStoredReducedMotion({ getItem: () => "not-json" }),
    ).toBe(false);
  });
});
