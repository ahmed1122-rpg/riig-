import type { CharacterJob } from "@motionprep/contracts";
import { CharacterJobError } from "./character-job-error.js";
import type { CharacterJobResult } from "./character-job-result-committer.js";
import type { CharacterJobExecutionContext } from "./character-job-execution-context.js";

export async function cleanupResultArtifacts(
  context: CharacterJobExecutionContext,
  result: CharacterJobResult,
): Promise<void> {
  await Promise.all(
    [result.rig.psdArtifact, result.rig.manifestArtifact]
      .filter((artifact) => artifact !== null)
      .map((artifact) => removeFailedArtifact(context, artifact.objectKey)),
  );
}

export async function removeFailedArtifact(
  context: CharacterJobExecutionContext,
  objectKey: string,
): Promise<void> {
  try {
    await context.storage.purge([objectKey], []);
  } catch (error) {
    try {
      context.onArtifactCleanupError?.(error, objectKey);
    } catch {
      // Preserve the original job failure when observability is degraded.
    }
  }
}

export function requiredPayloadId(job: CharacterJob, key: string): string {
  const value = optionalPayloadId(job, key);
  if (!value) {
    throw new CharacterJobError("CHARACTER_JOB_PAYLOAD_INVALID");
  }
  return value;
}

export function optionalPayloadId(job: CharacterJob, key: string): string | null {
  const value = job.payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function requiredPayloadNumber(job: CharacterJob, key: string): number {
  const value = job.payload[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new CharacterJobError("CHARACTER_JOB_PAYLOAD_INVALID");
  }
  return value;
}

export function characterJobErrorCode(error: unknown): string {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^CHARACTER_|^RASTER_/u.test(error.code)
    ? error.code
    : "CHARACTER_WORKER_FAILED";
}

export function retryDelayMilliseconds(attempt: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}

export function throwIfCharacterJobAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new CharacterJobError("CHARACTER_JOB_ABORTED");
  }
}

export function isRetryableCharacterJobError(errorCode: string): boolean {
  return new Set([
    "CHARACTER_PROVIDER_TIMEOUT",
    "CHARACTER_PROVIDER_UNAVAILABLE",
    "CHARACTER_PROVIDER_RATE_LIMITED",
    "CHARACTER_WORKER_FAILED",
  ]).has(errorCode);
}
