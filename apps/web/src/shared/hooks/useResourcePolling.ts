import { useEffect, useRef } from "react";
import { ApiError } from "../../lib/api/transport";

interface SharedRequest<T> {
  controller: AbortController;
  promise: Promise<T>;
  consumers: number;
}

interface RequestTicket<T> {
  promise: Promise<T>;
  release: () => void;
}

const requests = new Map<string, SharedRequest<unknown>>();

function acquireRequest<T>(
  resourceKey: string,
  load: (signal: AbortSignal) => Promise<T>,
): RequestTicket<T> {
  let request = requests.get(resourceKey) as SharedRequest<T> | undefined;
  if (!request) {
    const controller = new AbortController();
    const shared: SharedRequest<T> = {
      controller,
      consumers: 0,
      promise: Promise.resolve().then(() => load(controller.signal)),
    };
    request = shared;
    requests.set(resourceKey, shared as SharedRequest<unknown>);
    void shared.promise.finally(() => {
      if (requests.get(resourceKey) === shared) requests.delete(resourceKey);
    }).catch(() => undefined);
  }
  request.consumers += 1;
  let released = false;
  return {
    promise: request.promise,
    release: () => {
      if (released) return;
      released = true;
      request!.consumers -= 1;
      if (
        request!.consumers === 0 &&
        requests.get(resourceKey) === request
      ) {
        requests.delete(resourceKey);
        request!.controller.abort();
      }
    },
  };
}

export interface ResourcePollingOptions<T> {
  enabled: boolean;
  resourceKey: string;
  revision?: number;
  intervalMs: number;
  maximumRetryIntervalMs?: number;
  load: (signal: AbortSignal) => Promise<T>;
  shouldPoll: (value: T) => boolean;
  onSuccess: (value: T) => void;
  onError: (error: unknown) => void;
}

export function useResourcePolling<T>(
  options: ResourcePollingOptions<T>,
): void {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    if (!options.enabled) return;
    let active = true;
    let pollingWanted = true;
    let failureCount = 0;
    let timer: number | undefined;
    let releaseRequest: (() => void) | undefined;

    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const available = () =>
      document.visibilityState !== "hidden" && navigator.onLine !== false;
    const schedule = (delayMs: number) => {
      clearTimer();
      if (!active || !pollingWanted || !available()) return;
      timer = window.setTimeout(() => void poll(), delayMs);
    };
    const retryDelay = (error: unknown) => {
      if (error instanceof ApiError && error.retryAfterMs !== undefined) {
        return error.retryAfterMs;
      }
      const maximum = latest.current.maximumRetryIntervalMs ?? 30_000;
      const exponential = Math.min(
        maximum,
        latest.current.intervalMs * 2 ** Math.min(failureCount, 5),
      );
      return exponential + Math.round(Math.random() * 250);
    };
    const retryable = (error: unknown) =>
      !(error instanceof ApiError) ||
      error.status === 0 ||
      error.retryable ||
      error.status >= 500;
    const poll = async () => {
      if (!active || releaseRequest || !pollingWanted || !available()) return;
      const ticket = acquireRequest(
        latest.current.resourceKey,
        latest.current.load,
      );
      releaseRequest = ticket.release;
      try {
        const value = await ticket.promise;
        if (!active) return;
        failureCount = 0;
        latest.current.onSuccess(value);
        pollingWanted = latest.current.shouldPoll(value);
        if (pollingWanted) schedule(latest.current.intervalMs);
      } catch (error) {
        if (!active || error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        failureCount += 1;
        latest.current.onError(error);
        pollingWanted = retryable(error);
        if (pollingWanted) schedule(retryDelay(error));
      } finally {
        ticket.release();
        if (releaseRequest === ticket.release) releaseRequest = undefined;
      }
    };
    const resume = () => {
      clearTimer();
      if (available() && pollingWanted) void poll();
    };
    const pause = () => {
      clearTimer();
      releaseRequest?.();
      releaseRequest = undefined;
    };
    const handleAvailability = () => {
      if (available()) resume();
      else pause();
    };

    document.addEventListener("visibilitychange", handleAvailability);
    window.addEventListener("online", handleAvailability);
    window.addEventListener("offline", handleAvailability);
    void poll();
    return () => {
      active = false;
      clearTimer();
      releaseRequest?.();
      document.removeEventListener("visibilitychange", handleAvailability);
      window.removeEventListener("online", handleAvailability);
      window.removeEventListener("offline", handleAvailability);
    };
  }, [
    options.enabled,
    options.intervalMs,
    options.maximumRetryIntervalMs,
    options.resourceKey,
    options.revision,
  ]);
}
