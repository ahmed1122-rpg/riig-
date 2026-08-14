import { describe, expect, it, vi } from "vitest";
import { runExportWithDeadline } from "./export-job-deadline.js";

describe("runExportWithDeadline", () => {
  it("returns a completed export without firing the deadline", async () => {
    const onTimeout = vi.fn();
    await expect(
      runExportWithDeadline(async () => "ready", 1_000, onTimeout),
    ).resolves.toBe("ready");
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("fails with an explicit code and requests worker recycling", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const pending = runExportWithDeadline(
      () => new Promise<string>(() => undefined),
      1_000,
      onTimeout,
    );
    const rejection = expect(pending).rejects.toMatchObject({
      code: "EXPORT_DEADLINE_EXCEEDED",
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(onTimeout).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
