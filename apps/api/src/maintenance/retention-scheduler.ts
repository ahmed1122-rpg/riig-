import type { RetentionCleanupReport } from "./retention-cleanup.js";

export interface RetentionSchedulerOptions {
  intervalMilliseconds: number;
  signal: AbortSignal;
  run(): Promise<RetentionCleanupReport | null>;
  onReport(report: RetentionCleanupReport | null): void;
  onError(error: unknown): void;
}

export async function runRetentionScheduler(
  options: RetentionSchedulerOptions,
): Promise<void> {
  while (!options.signal.aborted) {
    try {
      options.onReport(await options.run());
    } catch (error) {
      options.onError(error);
    }
    await abortableDelay(options.intervalMilliseconds, options.signal);
  }
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
