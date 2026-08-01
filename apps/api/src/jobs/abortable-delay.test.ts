import { afterEach, describe, expect, it, vi } from "vitest";
import { abortableDelay } from "./abortable-delay.js";

describe("abortable delay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately for an already aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(abortableDelay(60_000, controller.signal)).resolves.toBeUndefined();
  });

  it("clears the timer and resolves when aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = abortableDelay(60_000, controller.signal);

    expect(vi.getTimerCount()).toBe(1);
    controller.abort();

    await expect(pending).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves when the delay elapses", async () => {
    vi.useFakeTimers();
    const pending = abortableDelay(250);

    await vi.advanceTimersByTimeAsync(250);

    await expect(pending).resolves.toBeUndefined();
  });
});
