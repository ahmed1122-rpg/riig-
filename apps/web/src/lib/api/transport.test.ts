import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  abortableDelay,
  request,
  resolveApiOrigin,
} from "./transport";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("resolveApiOrigin", () => {
  const location = {
    origin: "https://studio.example.com",
    protocol: "https:",
    hostname: "studio.example.com",
  };

  it("uses same-origin in production", () => {
    expect(resolveApiOrigin(undefined, true, location)).toBe(location.origin);
    expect(
      resolveApiOrigin("https://studio.example.com/", true, location),
    ).toBe(location.origin);
  });

  it("rejects a cross-origin production API", () => {
    expect(() =>
      resolveApiOrigin("https://api.example.com", true, location),
    ).toThrow(/same origin/);
  });

  it("uses the development host fallback and normalizes configured paths", () => {
    expect(resolveApiOrigin(undefined, false, location)).toBe(
      "https://studio.example.com:4000",
    );
    expect(
      resolveApiOrigin(" https://api.example.com/// ", false, location),
    ).toBe("https://api.example.com");
  });
});

describe("request", () => {
  it("accepts falsy response data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: false, error: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(request<boolean>("/v1/feature", { retries: 0 })).resolves.toBe(
      false,
    );
  });

  it("normalizes an HTML gateway failure and preserves its request id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>bad gateway</html>", {
          status: 502,
          headers: {
            "content-type": "text/html",
            "x-request-id": "request-502",
          },
        }),
      ),
    );

    const error = await request("/v1/projects", { retries: 0 }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "HTTP_502",
      status: 502,
      requestId: "request-502",
      retryable: true,
    });
  });

  it("rejects malformed successful JSON with a supportable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("{", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(request("/v1/projects", { retries: 0 })).rejects.toMatchObject({
      code: "RESPONSE_INVALID",
      status: 200,
    });
  });

  it("accepts an empty 204 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );

    await expect(request<void>("/v1/logout", { retries: 0 })).resolves.toBe(
      undefined,
    );
  });

  it("rejects successful responses without a complete API envelope", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("plain text", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: null, error: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("/v1/plain", { retries: 0 })).rejects.toMatchObject({
      code: "RESPONSE_INVALID",
    });
    await expect(request("/v1/empty", { retries: 0 })).rejects.toMatchObject({
      code: "RESPONSE_INVALID",
    });
  });

  it("uses the API error payload and normalizes malformed error JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: null,
            error: {
              code: "PROJECT_STALE",
              message: "stale",
              requestId: "payload-request",
            },
          }),
          {
            status: 409,
            headers: {
              "content-type": "application/json",
              "x-request-id": "header-request",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response("{", {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("/v1/project", { retries: 0 })).rejects.toMatchObject({
      code: "PROJECT_STALE",
      message: "stale",
      requestId: "payload-request",
    });
    await expect(request("/v1/project", { retries: 0 })).rejects.toMatchObject({
      code: "HTTP_503",
      status: 503,
      retryable: true,
    });
  });

  it.each([401, 403, 404, 409, 413, 429, 500, 418])(
    "provides a safe fallback message for HTTP %i",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(null, { status })),
      );

      const error = await request("/v1/failure", { retries: 0 }).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status });
      expect((error as Error).message.length).toBeGreaterThan(0);
    },
  );

  it("sets transport headers without replacing an explicit content type", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: true, error: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await request("/v1/json", {
      method: "POST",
      body: JSON.stringify({ ready: true }),
    });
    await request("/v1/text", {
      method: "POST",
      body: "ready",
      headers: { "content-type": "text/plain" },
    });

    const firstInit = fetchMock.mock.calls[0]![1] as RequestInit;
    const secondInit = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(firstInit.credentials).toBe("include");
    expect(new Headers(firstInit.headers).get("accept")).toBe(
      "application/json",
    );
    expect(new Headers(firstInit.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(new Headers(secondInit.headers).get("content-type")).toBe(
      "text/plain",
    );
  });

  it("retries an idempotent mutation after a retryable network failure", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: "saved", error: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const pending = request<string>("/v1/project", {
      method: "PATCH",
      headers: { "x-idempotency-key": "save-1" },
    });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe("saved");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("turns an attempt timeout into a retryable API error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        const signal = init.signal!;
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      }),
    );

    const pending = request("/v1/slow", { timeoutMs: 25, retries: 0 });
    const assertion = expect(pending).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
      status: 408,
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it("preserves an external cancellation reason", async () => {
    const controller = new AbortController();
    const reason = new DOMException("navigation", "AbortError");
    controller.abort(reason);
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) =>
        Promise.reject(init.signal?.reason),
      ),
    );

    await expect(
      request("/v1/cancelled", {
        signal: controller.signal,
        retries: 2,
      }),
    ).rejects.toBe(reason);
  });
});

describe("abortableDelay", () => {
  it("resolves normally and rejects both early and in-flight cancellation", async () => {
    vi.useFakeTimers();
    const completed = abortableDelay(20);
    await vi.advanceTimersByTimeAsync(20);
    await expect(completed).resolves.toBeUndefined();

    const earlyController = new AbortController();
    const earlyReason = new DOMException("early", "AbortError");
    earlyController.abort(earlyReason);
    await expect(
      abortableDelay(20, earlyController.signal),
    ).rejects.toBe(earlyReason);

    const activeController = new AbortController();
    const activeReason = new DOMException("active", "AbortError");
    const active = abortableDelay(20, activeController.signal);
    activeController.abort(activeReason);
    await expect(active).rejects.toBe(activeReason);
  });
});
