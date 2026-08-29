/**
 * Converts an unknown thrown value into a stable operator-facing message.
 * JavaScript permits throwing any value, and even a custom `toString` can
 * throw, so logging paths must never introduce a second failure.
 */
export function unknownErrorMessage(
  error: unknown,
  fallback = "Unknown error",
): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  try {
    const message = String(error);
    return message.trim() ? message : fallback;
  } catch {
    return fallback;
  }
}
