/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useResourcePolling } from "./useResourcePolling";

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  vi.restoreAllMocks();
});

function PollingHarness({
  load,
  onSuccess,
}: {
  load: (signal: AbortSignal) => Promise<string>;
  onSuccess: (value: string) => void;
}) {
  useResourcePolling({
    enabled: true,
    resourceKey: "shared-resource",
    intervalMs: 1_000,
    load,
    shouldPoll: () => false,
    onSuccess,
    onError: vi.fn(),
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
});
