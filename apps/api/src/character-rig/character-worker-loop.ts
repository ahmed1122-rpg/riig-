import type { CharacterJob } from "@motionprep/contracts";
import { abortableDelay } from "../jobs/abortable-delay.js";
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
  await abortableDelay(
    initialPollingDelay(options.pollMilliseconds),
    options.signal,
    options.delay,
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
          options.delay,
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
        } catch (releaseError) {
          // The lease remains fenced and recoverable after expiry if the
          // repository itself is temporarily unavailable.
          notifyLoopError(options, releaseError);
        }
      }
      notifyLoopError(options, error);
      await abortableDelay(
        Math.min(
          30_000,
          options.pollMilliseconds * 2 ** Math.min(consecutiveErrors, 5),
        ),
        options.signal,
        options.delay,
      );
    } finally {
      if (registered && claimedJob) {
        try {
          options.onFinished?.(claimedJob);
        } catch (callbackError) {
          // Drain bookkeeping and logging callbacks must not terminate a loop.
          notifyLoopError(options, callbackError);
        }
      }
    }
  }
}

function notifyLoopError(
  options: Pick<CharacterWorkerLoopOptions, "onLoopError">,
  error: unknown,
): void {
  try {
    options.onLoopError?.(error);
  } catch {
    // A failing observer must not terminate the durable worker loop.
  }
}
