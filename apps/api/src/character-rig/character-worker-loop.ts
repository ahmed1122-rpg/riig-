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
  onSettled?: (job: CharacterJob) => void | Promise<void>;
}

export async function runCharacterWorkerLoop(
  options: CharacterWorkerLoopOptions,
): Promise<void> {
  const delay = options.delay ?? defaultDelay;
  await delay(initialPollingDelay(options.pollMilliseconds));
  while (!options.signal.aborted) {
    const claimedAt = options.now?.() ?? new Date();
    const job = await options.jobs.claimNext(
      options.workerId,
      claimedAt.toISOString(),
      new Date(claimedAt.getTime() + options.leaseMilliseconds).toISOString(),
    );
    if (!job) {
      await delay(jitteredPollingDelay(options.pollMilliseconds));
      continue;
    }
    const result = await executeClaimedCharacterJob(options, job);
    await options.onSettled?.(result ?? job);
  }
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
