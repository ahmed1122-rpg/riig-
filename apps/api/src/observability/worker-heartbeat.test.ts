import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { startWorkerHeartbeat } from "./worker-heartbeat.js";

const input = {
  instanceId: "worker-test-1",
  workerType: "media" as const,
  releaseVersion: "test",
  concurrency: 1,
};

describe("worker heartbeat", () => {
  it("reports periodic database failures without rejecting in the timer", async () => {
    const failure = new Error("database unavailable");
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValue(failure);
    const onError = vi.fn();
    const heartbeat = await startWorkerHeartbeat(
      { query } as unknown as Pool,
      { ...input, onError },
      5,
    );

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    await heartbeat.stop();
  });

  it("fails startup when the initial heartbeat cannot be written", async () => {
    const query = vi.fn().mockRejectedValue(new Error("database unavailable"));

    await expect(
      startWorkerHeartbeat({ query } as unknown as Pool, input, 5),
    ).rejects.toThrow("database unavailable");
  });
});
