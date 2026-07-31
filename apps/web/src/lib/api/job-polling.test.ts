import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./transport";
import { waitForJob } from "./job-polling";

describe("waitForJob", () => {
  it("returns an already completed job without polling", async () => {
    const load = vi.fn();
    const onProgress = vi.fn();
    const job = { status: "ready", progress: 100 };

    await expect(
      waitForJob({
        initial: job,
        load,
        isComplete: (current) => current.status === "ready",
        failure: () => undefined,
        timeoutMs: 1_000,
        timeoutCode: "TIMEOUT",
        timeoutMessage: "timeout",
        onProgress,
      }),
    ).resolves.toBe(job);
    expect(load).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledWith(100);
  });

  it("surfaces a terminal domain failure before polling again", async () => {
    const failure = new ApiError("JOB_FAILED", "failed", 422);
    await expect(
      waitForJob({
        initial: { status: "failed", progress: 20 },
        load: vi.fn(),
        isComplete: () => false,
        failure: () => failure,
        timeoutMs: 1_000,
        timeoutCode: "TIMEOUT",
        timeoutMessage: "timeout",
      }),
    ).rejects.toBe(failure);
  });

  it("backs off while progress is unchanged and resets after progress", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ status: "processing", progress: 10 })
      .mockResolvedValueOnce({ status: "processing", progress: 60 })
      .mockResolvedValueOnce({ status: "ready", progress: 100 });
    const onProgress = vi.fn();

    await expect(
      waitForJob({
        initial: { status: "queued", progress: 10 },
        load,
        isComplete: (current) => current.status === "ready",
        failure: () => undefined,
        timeoutMs: 1_000,
        timeoutCode: "TIMEOUT",
        timeoutMessage: "timeout",
        initialIntervalMs: 1,
        maximumIntervalMs: 2,
        onProgress,
      }),
    ).resolves.toEqual({ status: "ready", progress: 100 });

    expect(load).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      10,
      60,
      100,
    ]);
  });

  it("returns a typed timeout before issuing another poll", async () => {
    await expect(
      waitForJob({
        initial: { status: "queued", progress: 0 },
        load: vi.fn(),
        isComplete: () => false,
        failure: () => undefined,
        timeoutMs: 0,
        timeoutCode: "PROCESSING_TIMEOUT",
        timeoutMessage: "processing timed out",
      }),
    ).rejects.toMatchObject({
      code: "PROCESSING_TIMEOUT",
      message: "processing timed out",
      status: 408,
    });
  });
});
