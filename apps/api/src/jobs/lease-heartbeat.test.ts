import { afterEach, describe, expect, it, vi } from "vitest";
import { startLeaseHeartbeat } from "./lease-heartbeat.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("startLeaseHeartbeat", () => {
  it("does not overlap slow lease renewals", async () => {
    vi.useFakeTimers();
    let finishRenewal: ((renewed: boolean) => void) | undefined;
    const renew = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishRenewal = resolve;
        }),
    );
    const heartbeat = startLeaseHeartbeat(renew, 30_000);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(renew).toHaveBeenCalledTimes(1);

    finishRenewal?.(true);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(renew).toHaveBeenCalledTimes(2);
    heartbeat.stop();
  });

  it.each([
    ["a rejected renewal", () => Promise.resolve(false)],
    ["a failed renewal", () => Promise.reject(new Error("database unavailable"))],
  ])("marks the lease as lost after %s", async (_label, renew) => {
    vi.useFakeTimers();
    const heartbeat = startLeaseHeartbeat(renew, 30_000);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(heartbeat.leaseLost()).toBe(true);
    heartbeat.stop();
  });
});
