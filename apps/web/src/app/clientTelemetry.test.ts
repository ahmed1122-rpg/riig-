/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("client telemetry", () => {
  it("bounds and deduplicates React error reports before transport", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { reportReactError } = await import("./clientTelemetry");
    const error = new Error("x".repeat(700));
    error.name = "T".repeat(180);
    error.stack = "s".repeat(5_000);

    reportReactError({ error, componentStack: "c".repeat(3_000) });
    reportReactError({ error, componentStack: "c".repeat(3_000) });

    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ kind: "react", route: "/" });
    expect(String(body.errorName)).toHaveLength(128);
    expect(String(body.message)).toHaveLength(500);
    expect(String(body.stack)).toHaveLength(4_000);
    expect(String(body.componentStack)).toHaveLength(2_000);
    expect(request).toMatchObject({ credentials: "omit", keepalive: true });
  });

  it("flushes the final LCP once and removes listeners during cleanup", async () => {
    let observerCallback: PerformanceObserverCallback | undefined;
    const disconnect = vi.fn();
    class FakePerformanceObserver {
      static readonly supportedEntryTypes = ["largest-contentful-paint"];
      constructor(callback: PerformanceObserverCallback) {
        observerCallback = callback;
      }
      observe(): void {}
      disconnect(): void {
        disconnect();
      }
      takeRecords(): PerformanceEntryList {
        return [];
      }
    }
    vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { installClientTelemetry } = await import("./clientTelemetry");
    const cleanup = installClientTelemetry();

    observerCallback?.(
      { getEntries: () => [{ startTime: 2_345 }] } as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toMatchObject({
      kind: "performance",
      lcpMilliseconds: 2_345,
    });
    cleanup();
    window.dispatchEvent(new ErrorEvent("error", { message: "after cleanup" }));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalled();
  });
});
