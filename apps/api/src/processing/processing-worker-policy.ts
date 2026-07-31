export interface ProcessingRetryPolicy {
  retry: boolean;
  delayMilliseconds: number;
}

export function getProcessingRetryPolicy(
  attempt: number,
  maxAttempts: number,
): ProcessingRetryPolicy {
  const normalizedAttempt = Math.max(1, Math.trunc(attempt));
  return {
    retry: normalizedAttempt < Math.max(1, Math.trunc(maxAttempts)),
    delayMilliseconds: Math.min(
      60_000,
      2 ** (normalizedAttempt - 1) * 1_000,
    ),
  };
}
