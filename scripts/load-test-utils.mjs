export function parsePositiveInteger(value, fallback, name, maximum = 1_000) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

export function parseNonNegativeNumber(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }
  return parsed;
}

export function parseRate(value, fallback, name) {
  const parsed = parseNonNegativeNumber(value, fallback, name);
  if (parsed > 1) throw new Error(`${name} must be between 0 and 1.`);
  return parsed;
}

export function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[index] ?? 0;
}

export function summarizeDurations(samples) {
  const grouped = new Map();
  for (const sample of samples) {
    const values = grouped.get(sample.stage) ?? [];
    values.push(sample.durationMs);
    grouped.set(sample.stage, values);
  }
  return Object.fromEntries(
    [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
      ([stage, values]) => [
        stage,
        {
          count: values.length,
          minMs: Math.min(...values),
          p50Ms: percentile(values, 0.5),
          p95Ms: percentile(values, 0.95),
          p99Ms: percentile(values, 0.99),
          maxMs: Math.max(...values),
        },
      ],
    ),
  );
}

export function prometheusMetricValues(body, name, requiredLabels = {}) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const matcher = new RegExp(
    `^${escapedName}(?:\\{([^}]*)\\})?\\s+([0-9.eE+-]+)$`,
    "gmu",
  );
  const values = [];
  for (const match of body.matchAll(matcher)) {
    const labels = match[1] ?? "";
    const selected = Object.entries(requiredLabels).every(
      ([label, value]) => labels.includes(`${label}="${value}"`),
    );
    const parsed = Number(match[2]);
    if (selected && Number.isFinite(parsed)) values.push(parsed);
  }
  return values;
}

export async function runWithConcurrency(items, concurrency, operation) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await operation(items[index], index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}
