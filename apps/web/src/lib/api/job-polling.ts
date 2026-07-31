import { ApiError, abortableDelay } from "./transport";

export interface PollableJob {
  status: string;
  progress: number;
}

interface WaitForJobOptions<T extends PollableJob> {
  initial: T;
  load: () => Promise<T>;
  isComplete: (job: T) => boolean;
  failure: (job: T) => ApiError | undefined;
  timeoutMs: number;
  timeoutCode: string;
  timeoutMessage: string;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  initialIntervalMs?: number;
  maximumIntervalMs?: number;
}

export async function waitForJob<T extends PollableJob>(
  options: WaitForJobOptions<T>,
): Promise<T> {
  const startedAt = Date.now();
  const initialInterval = options.initialIntervalMs ?? 750;
  const maximumInterval = options.maximumIntervalMs ?? 3_000;
  let interval = initialInterval;
  let current = options.initial;
  let lastProgress = -1;

  while (true) {
    if (current.progress !== lastProgress) {
      lastProgress = current.progress;
      options.onProgress?.(current.progress);
    }
    const failure = options.failure(current);
    if (failure) throw failure;
    if (options.isComplete(current)) return current;
    if (Date.now() - startedAt >= options.timeoutMs) {
      throw new ApiError(
        options.timeoutCode,
        options.timeoutMessage,
        408,
      );
    }

    await abortableDelay(interval, options.signal);
    const previousProgress = current.progress;
    current = await options.load();
    interval =
      current.progress > previousProgress
        ? initialInterval
        : Math.min(maximumInterval, Math.round(interval * 1.5));
  }
}
