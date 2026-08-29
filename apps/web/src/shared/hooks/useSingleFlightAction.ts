import { useCallback, useRef, useState } from "react";

/**
 * Runs one user action at a time and exposes a consistent accessible error.
 * The ref closes the small double-click window before React renders `disabled`.
 */
export function useSingleFlightAction(fallbackError: string) {
  const running = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const run = useCallback(async (action: () => Promise<void>) => {
    if (running.current) return false;
    running.current = true;
    setSubmitting(true);
    setError(undefined);
    try {
      await action();
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message.trim()
          ? caught.message
          : fallbackError,
      );
      return false;
    } finally {
      running.current = false;
      setSubmitting(false);
    }
  }, [fallbackError]);

  return { submitting, error, setError, run } as const;
}
