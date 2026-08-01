import { describe, expect, it, vi } from "vitest";
import {
  createRedisRateLimitStore,
  type RateLimitStore,
} from "./redis-rate-limit-store.js";

describe("Redis rate-limit store", () => {
  it("uses a hashed distributed key and returns the Redis counter", async () => {
    const sendCommand = vi.fn(async (_arguments: string[]) => [3, 42_000]);
    const Store = createRedisRateLimitStore({ sendCommand });
    const store = new Store({ continueExceeding: false });

    await expect(increment(store, "203.0.113.10")).resolves.toEqual({
      current: 3,
      ttl: 42_000,
    });
    const command = sendCommand.mock.calls[0]![0];
    expect(command).not.toContain("203.0.113.10");
    expect(command[3]).toMatch(/^motionprep:rate-limit:global:[a-f0-9]{64}$/u);
  });

  it("isolates custom route limits from the global namespace", async () => {
    const sendCommand = vi.fn(async (_arguments: string[]) => [1, 60_000]);
    const Store = createRedisRateLimitStore({ sendCommand });
    const store = new Store({});
    const child = store.child({
      method: "POST",
      url: "/v1/auth/login",
      path: "/v1/auth/login",
      prefix: "",
    } as Parameters<RateLimitStore["child"]>[0]);

    await increment(child, "client");
    expect(sendCommand.mock.calls[0]![0][3]).toMatch(
      /^motionprep:rate-limit:route:[a-f0-9]{64}:[a-f0-9]{64}$/u,
    );
  });
});

function increment(
  store: Pick<RateLimitStore, "incr">,
  key: string,
): Promise<{ current: number; ttl: number }> {
  return new Promise((resolve, reject) => {
    store.incr(
      key,
      (error, result) => {
        if (error) reject(error);
        else resolve(result!);
      },
      60_000,
      300,
    );
  });
}
