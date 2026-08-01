const DEFAULT_JITTER_RATIO = 0.2;

export function initialPollingDelay(
  baseMilliseconds: number,
  random: () => number = Math.random,
): number {
  const base = normalizedDelay(baseMilliseconds);
  return Math.floor(clampedRandom(random()) * base);
}

export function jitteredPollingDelay(
  baseMilliseconds: number,
  random: () => number = Math.random,
  ratio = DEFAULT_JITTER_RATIO,
): number {
  const base = normalizedDelay(baseMilliseconds);
  const boundedRatio = Math.max(0, Math.min(1, ratio));
  const minimum = base * (1 - boundedRatio);
  const range = base * boundedRatio * 2;
  return Math.round(minimum + clampedRandom(random()) * range);
}

function normalizedDelay(milliseconds: number): number {
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
}

function clampedRandom(value: number): number {
  return Math.max(0, Math.min(1, value));
}
