/** @vitest-environment jsdom */

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useResourcePolling } from "./useResourcePolling";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  vi.restoreAllMocks();
});

function PollingHarness({
  load,
  onSuccess,
  onError = vi.fn(),
  onExhausted,
  maximumInitialFailures,
  revision = 0,
  shouldPoll = () => false,
}: {
  load: (signal: AbortSignal) => Promise<string>;
  onSuccess: (value: string) => void;
  onError?: (error: unknown) => void;
  onExhausted?: ((error: unknown) => void) | undefined;
  maximumInitialFailures?: number | undefined;
  revision?: number;
  shouldPoll?: (value: string) => boolean;
}) {
  useResourcePolling({
    enabled: true,
    resourceKey: "shared-resource",
    revision,
    intervalMs: 1_000,
    ...(maximumInitialFailures === undefined
      ? {}
      : { initialRetryLimit: maximumInitialFailures }),
    ...(onExhausted ? { onInitialRetryExhausted: onExhausted } : {}),
    load,
    shouldPoll,
    onSuccess,
    onError,
  });
  return null;
}

describe("useResourcePolling", () => {
  it("deduplicates concurrent requests for the same resource key", async () => {
    const load = vi.fn().mockResolvedValue("ready");
    const first = vi.fn();
    const second = vi.fn();
    render(
      <>
        <PollingHarness load={load} onSuccess={first} />
        <PollingHarness load={load} onSuccess={second} />
      </>,
    );

    await waitFor(() => {
      expect(first).toHaveBeenCalledWith("ready");
      expect(second).toHaveBeenCalledWith("ready");
    });
    expect(load).toHaveBeenCalledOnce();
  });

  it("waits while offline and resumes when connectivity returns", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    const load = vi.fn().mockResolvedValue("ready");
    render(<PollingHarness load={load} onSuccess={vi.fn()} />);
    expect(load).not.toHaveBeenCalled();

    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
  });

  it("aborts an orphaned in-flight request on unmount", async () => {
    let observedSignal: AbortSignal | undefined;
    const load = vi.fn((signal: AbortSignal) => {
      observedSignal = signal;
      return new Promise<string>(() => undefined);
    });
    const view = render(<PollingHarness load={load} onSuccess={vi.fn()} />);
    await waitFor(() => expect(observedSignal).toBeDefined());

    view.unmount();
    expect(observedSignal?.aborted).toBe(true);
  });

  it("stops bounded initial retries and lets revision trigger a manual retry", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const failure = new Error("offline");
    const load = vi.fn().mockRejectedValue(failure);
    const onError = vi.fn();
    const onExhausted = vi.fn();
    const view = render(
      <PollingHarness
        load={load}
        onSuccess={vi.fn()}
        onError={onError}
        onExhausted={onExhausted}
        maximumInitialFailures={2}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(load).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onExhausted).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(load).toHaveBeenCalledTimes(2);

    view.rerender(
      <PollingHarness
        load={load}
        onSuccess={vi.fn()}
        onError={onError}
        onExhausted={onExhausted}
        maximumInitialFailures={2}
        revision={1}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("keeps retrying active resources after a successful value", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const load = vi
      .fn()
      .mockResolvedValueOnce("active")
      .mockRejectedValue(new Error("temporary outage"));
    render(
      <PollingHarness
        load={load}
        onSuccess={vi.fn()}
        maximumInitialFailures={1}
        shouldPoll={() => true}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(load.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
