import type { CharacterJob } from "@motionprep/contracts";
import { initialPollingDelay, jitteredPollingDelay } from "../jobs/polling-delay.js";
import {
  executeClaimedCharacterJob,
  type CharacterJobExecutionContext,
} from "./character-job-executor.js";

export interface CharacterWorkerLoopOptions extends CharacterJobExecutionContext {
  pollMilliseconds: number;
  signal: AbortSignal;
  delay?: (milliseconds: number) => Promise<void>;
  onClaimed?: (job: CharacterJob) => boolean | Promise<boolean>;
  onSettled?: (job: CharacterJob, durationMs: number) => void | Promise<void>;
  onFinished?: (job: CharacterJob) => void;
  onLoopError?: (error: unknown) => void;
}

export async function runCharacterWorkerLoop(
  options: CharacterWorkerLoopOptions,
): Promise<void> {
  const delay = options.delay ?? defaultDelay;
  await abortableDelay(
    initialPollingDelay(options.pollMilliseconds),
    options.signal,
    delay,
  );
  let consecutiveErrors = 0;
  while (!options.signal.aborted) {
    let registered = false;
    let claimedJob: CharacterJob | null = null;
    try {
      const claimedAt = options.now?.() ?? new Date();
      const job = await options.jobs.claimNext(
        options.workerId,
        claimedAt.toISOString(),
        new Date(claimedAt.getTime() + options.leaseMilliseconds).toISOString(),
      );
      if (!job) {
        consecutiveErrors = 0;
        await abortableDelay(
          jitteredPollingDelay(options.pollMilliseconds),
          options.signal,
          delay,
        );
        continue;
      }
      claimedJob = job;
      registered = (await options.onClaimed?.(job)) ?? true;
      if (!registered) {
        await options.jobs.releaseClaim(
          job.id,
          options.workerId,
          (options.now?.() ?? new Date()).toISOString(),
        );
        continue;
      }
      const startedAt = Date.now();
      const result = await executeClaimedCharacterJob(options, job);
      await options.onSettled?.(result ?? job, Date.now() - startedAt);
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      if (claimedJob) {
        try {
          await options.jobs.releaseClaim(
            claimedJob.id,
            options.workerId,
            (options.now?.() ?? new Date()).toISOString(),
          );
        } catch {
          // The lease remains fenced and recoverable after expiry if the
          // repository itself is temporarily unavailable.
        }
      }
      try {
        options.onLoopError?.(error);
      } catch {
        // A logging failure must not terminate the worker loop.
      }
      await abortableDelay(
        Math.min(
          30_000,
          options.pollMilliseconds * 2 ** Math.min(consecutiveErrors, 5),
        ),
        options.signal,
        delay,
      );
    } finally {
      if (registered && claimedJob) {
        try {
          options.onFinished?.(claimedJob);
        } catch {
          // Drain bookkeeping and logging callbacks must not terminate a loop.
        }
      }
    }
  }
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
  delay: (milliseconds: number) => Promise<void>,
): Promise<void> {
  if (signal.aborted) return;
  let stop: (() => void) | undefined;
  await Promise.race([
    delay(milliseconds),
    new Promise<void>((resolve) => {
      stop = () => resolve();
      signal.addEventListener("abort", stop, { once: true });
    }),
  ]);
  if (stop) signal.removeEventListener("abort", stop);
}
