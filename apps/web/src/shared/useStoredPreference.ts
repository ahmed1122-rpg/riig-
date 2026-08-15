import { useEffect, useState } from "react";

export type StoredPreferenceValidator<T> = (value: unknown) => value is T;

export function useStoredPreference<T>(
  key: string,
  fallback: T,
  validate: StoredPreferenceValidator<T> = (value): value is T =>
    samePrimitiveType(value, fallback),
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === null) return fallback;
      const parsed: unknown = JSON.parse(stored);
      return validate(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The application remains functional when browser storage is unavailable.
    }
  }, [key, value]);

  return [value, setValue] as const;
}

function samePrimitiveType<T>(value: unknown, fallback: T): value is T {
  if (typeof value !== typeof fallback) return false;
  return typeof value !== "number" || Number.isFinite(value);
}
