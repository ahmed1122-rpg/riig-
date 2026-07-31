import { describe, expect, it } from "vitest";
import { getProcessingRetryPolicy } from "./processing-worker-policy.js";

describe("processing worker retry policy", () => {
  it("retries with bounded exponential delay before the final attempt", () => {
    expect(getProcessingRetryPolicy(1, 3)).toEqual({
      retry: true,
      delayMilliseconds: 1_000,
    });
    expect(getProcessingRetryPolicy(2, 3)).toEqual({
      retry: true,
      delayMilliseconds: 2_000,
    });
    expect(getProcessingRetryPolicy(9, 10)).toEqual({
      retry: true,
      delayMilliseconds: 60_000,
    });
  });

  it("fails after the configured maximum and normalizes invalid counters", () => {
    expect(getProcessingRetryPolicy(3, 3).retry).toBe(false);
    expect(getProcessingRetryPolicy(4, 3).retry).toBe(false);
    expect(getProcessingRetryPolicy(0, 0)).toEqual({
      retry: false,
      delayMilliseconds: 1_000,
    });
  });
});
