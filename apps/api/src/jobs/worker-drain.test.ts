import { describe, expect, it, vi } from "vitest";
import { WorkerDrainCoordinator } from "./worker-drain.js";

describe("WorkerDrainCoordinator", () => {
  it("does not release a job that finishes inside the drain window", async () => {
    vi.useFakeTimers();
    const released: string[] = [];
    const drain = new WorkerDrainCoordinator<string>({
      timeoutMilliseconds: 30_000,
      release: async (job) => {
        released.push(job);
      },
    });
    await drain.register("slot-1", "job-1");

    drain.requestShutdown();
    drain.unregister("slot-1");
    await drain.waitForRelease();
    await vi.runAllTimersAsync();

    expect(released).toEqual([]);
    vi.useRealTimers();
  });

  it("releases every active job after the drain window", async () => {
    vi.useFakeTimers();
    const released: string[] = [];
    const drain = new WorkerDrainCoordinator<string>({
      timeoutMilliseconds: 30_000,
      release: async (job) => {
        released.push(job);
      },
    });
    await drain.register("slot-1", "job-1");
    await drain.register("slot-2", "job-2");

    drain.requestShutdown();
    await vi.advanceTimersByTimeAsync(30_000);
    await drain.waitForRelease();

    expect(released).toEqual(["job-1", "job-2"]);
    vi.useRealTimers();
  });

  it("immediately releases a job claimed after shutdown was requested", async () => {
    const released: string[] = [];
    const drain = new WorkerDrainCoordinator<string>({
      timeoutMilliseconds: 30_000,
      release: async (job) => {
        released.push(job);
      },
    });
    drain.requestShutdown();

    const accepted = await drain.register("slot-1", "late-job");

    expect(accepted).toBe(false);
    expect(released).toEqual(["late-job"]);
  });

  it("finishes draining when release and its error callback both throw", async () => {
    vi.useFakeTimers();
    const onReleaseError = vi.fn(() => {
      throw new Error("logger unavailable");
    });
    const drain = new WorkerDrainCoordinator<string>({
      timeoutMilliseconds: 30_000,
      release: async () => {
        throw new Error("database unavailable");
      },
      onReleaseError,
    });
    await drain.register("slot-1", "job-1");

    drain.requestShutdown();
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(drain.waitForRelease()).resolves.toBeUndefined();

    expect(onReleaseError).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
