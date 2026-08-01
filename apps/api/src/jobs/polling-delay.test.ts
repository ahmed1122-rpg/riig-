import { describe, expect, it } from "vitest";
import { initialPollingDelay, jitteredPollingDelay } from "./polling-delay.js";

describe("worker polling delays", () => {
  it("staggers initial polling across the complete base interval", () => {
    expect(initialPollingDelay(1_000, () => 0)).toBe(0);
    expect(initialPollingDelay(1_000, () => 0.5)).toBe(500);
    expect(initialPollingDelay(1_000, () => 1)).toBe(1_000);
  });

  it("keeps steady-state jitter within a bounded range", () => {
    expect(jitteredPollingDelay(1_000, () => 0)).toBe(800);
    expect(jitteredPollingDelay(1_000, () => 0.5)).toBe(1_000);
    expect(jitteredPollingDelay(1_000, () => 1)).toBe(1_200);
  });

  it("does not emit negative or non-finite delays", () => {
    expect(initialPollingDelay(-100, () => 0.5)).toBe(0);
    expect(jitteredPollingDelay(Number.NaN, () => 0.5)).toBe(0);
  });
});
