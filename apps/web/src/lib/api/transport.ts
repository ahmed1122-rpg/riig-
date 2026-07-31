const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 502, 503, 504]);

interface BrowserLocation {
  origin: string;
  protocol: string;
  hostname: string;
}

function currentLocation(): BrowserLocation {
  if (typeof globalThis.location !== "undefined") {
    return globalThis.location;
  }
  return {
    origin: "http://127.0.0.1:5173",
    protocol: "http:",
    hostname: "127.0.0.1",
  };
}

export function resolveApiOrigin(
  configuredOrigin: string | undefined,
  production: boolean,
  location: BrowserLocation = currentLocation(),
): string {
  const fallback = production
    ? location.origin
    : `${location.protocol}//${location.hostname}:4000`;
  const origin = (configuredOrigin?.trim() || fallback).replace(/\/+$/, "");
  if (
    production &&
    new URL(origin, location.origin).origin !== location.origin
  ) {
    throw new Error(
      "Production requires the API to use the same origin as the web application.",
    );
  }
  return origin;
}

export const API_ORIGIN = resolveApiOrigin(
  import.meta.env.VITE_API_ORIGIN,
  import.meta.env.PROD,
);

export interface ApiEnvelope<T> {
  data: T | null;
  error: { code: string; message: string; requestId?: string } | null;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly requestId?: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    retries = defaultRetryCount(options),
    ...init
  } = options;
  const url = `${API_ORIGIN}${path}`;
  let attempt = 0;

  while (true) {
    try {
      return await requestAttempt<T>(url, init, timeoutMs);
    } catch (error) {
      if (
        attempt >= retries ||
        init.signal?.aborted ||
        !isRetryableError(error)
      ) {
        throw error;
      }
      attempt += 1;
      await abortableDelay(retryDelay(attempt), init.signal);
    }
  }
}

async function requestAttempt<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const attempt = createAttemptSignal(init.signal, timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: attempt.signal,
      credentials: "include",
      headers: requestHeaders(init),
    });
  } catch {
    if (init.signal?.aborted) throw abortReason(init.signal);
    if (attempt.timedOut()) {
      throw new ApiError(
        "REQUEST_TIMEOUT",
        "انتهت مهلة الاتصال بالخادم. تحقق من الاتصال ثم أعد المحاولة.",
        408,
        undefined,
        true,
      );
    }
    throw new ApiError(
      "NETWORK_ERROR",
      "تعذر الاتصال بالخادم. تحقق من الشبكة ثم أعد المحاولة.",
      0,
      undefined,
      true,
    );
  } finally {
    attempt.cleanup();
  }

  const requestId = response.headers.get("x-request-id") ?? undefined;
  const parsed = await parseResponse<T>(response, requestId);
  if (!response.ok) {
    const apiError = parsed.envelope?.error;
    throw new ApiError(
      apiError?.code ?? `HTTP_${response.status}`,
      apiError?.message ?? responseErrorMessage(response.status),
      response.status,
      apiError?.requestId ?? requestId,
      RETRYABLE_STATUSES.has(response.status),
    );
  }
  if (response.status === 204) return undefined as T;
  if (!parsed.envelope || parsed.envelope.data === null) {
    throw new ApiError(
      "RESPONSE_INVALID",
      "أعاد الخادم استجابة غير مكتملة.",
      response.status,
      requestId,
    );
  }
  return parsed.envelope.data;
}

async function parseResponse<T>(
  response: Response,
  requestId?: string,
): Promise<{ envelope?: ApiEnvelope<T> }> {
  const text = await response.text();
  if (!text.trim()) return {};
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const looksLikeJson = /^[\s]*[{[]/.test(text);
  if (!contentType.includes("json") && !looksLikeJson) return {};
  try {
    const value = JSON.parse(text) as unknown;
    return isApiEnvelope<T>(value) ? { envelope: value } : {};
  } catch {
    if (!response.ok) return {};
    throw new ApiError(
      "RESPONSE_INVALID",
      "تعذر قراءة استجابة الخادم.",
      response.status,
      requestId,
    );
  }
}

function isApiEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    "error" in value
  );
}

function requestHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers);
  if (
    init.body &&
    typeof init.body === "string" &&
    !headers.has("content-type")
  ) {
    headers.set("content-type", "application/json");
  }
  headers.set("accept", "application/json");
  return headers;
}

function defaultRetryCount(init: RequestInit): number {
  const method = (init.method ?? "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return 2;
  return new Headers(init.headers).has("x-idempotency-key") ? 1 : 0;
}

function isRetryableError(error: unknown): boolean {
  return error instanceof ApiError && error.retryable;
}

function retryDelay(attempt: number): number {
  const exponential = Math.min(2_000, 250 * 2 ** (attempt - 1));
  return exponential + Math.round(Math.random() * 150);
}

function responseErrorMessage(status: number): string {
  if (status === 401) return "انتهت الجلسة. سجّل الدخول ثم أعد المحاولة.";
  if (status === 403) return "لا تملك صلاحية تنفيذ هذه العملية.";
  if (status === 404) return "المورد المطلوب غير موجود.";
  if (status === 409) return "تعارضت العملية مع تحديث أحدث. حدّث البيانات ثم أعد المحاولة.";
  if (status === 413) return "حجم الطلب أكبر من الحد المسموح.";
  if (status === 429) return "تم إرسال طلبات كثيرة. انتظر قليلًا ثم أعد المحاولة.";
  if (status >= 500) return "الخدمة غير متاحة مؤقتًا. أعد المحاولة بعد لحظات.";
  return "تعذر إكمال الطلب.";
}

function createAttemptSignal(
  externalSignal: AbortSignal | null | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let didTimeout = false;
  const onAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    onAbort();
  } else {
    externalSignal?.addEventListener("abort", onAbort, { once: true });
  }
  const timeout = globalThis.setTimeout(() => {
    didTimeout = true;
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, Math.max(1, timeoutMs));
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    cleanup: () => {
      globalThis.clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onAbort);
    },
  };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

export function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      globalThis.clearTimeout(timeout);
      reject(abortReason(signal!));
    };
    const timeout = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
