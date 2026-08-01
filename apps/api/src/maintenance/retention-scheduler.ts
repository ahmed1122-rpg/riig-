import type { RetentionCleanupReport } from "./retention-cleanup.js";
import { abortableDelay } from "../jobs/abortable-delay.js";

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
