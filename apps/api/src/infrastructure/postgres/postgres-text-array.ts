export function normalizePostgresTextArray(
  value: readonly string[] | null | undefined,
): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry) => typeof entry === "string" && entry.length > 0))]
        .sort((left, right) => left.localeCompare(right))
    : [];
}
