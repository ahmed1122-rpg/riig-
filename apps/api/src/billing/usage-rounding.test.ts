import { describe, expect, it } from "vitest";
import { roundUsage } from "./usage-rounding.js";

describe("usage rounding", () => {
  it("rounds usage to two decimal places", () => {
    expect(roundUsage(1.234)).toBe(1.23);
    expect(roundUsage(1.235)).toBe(1.24);
    expect(roundUsage(0)).toBe(0);
  });
});
