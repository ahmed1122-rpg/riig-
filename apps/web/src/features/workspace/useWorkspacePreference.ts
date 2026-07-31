import { useEffect, useState } from "react";

export function useWorkspacePreference<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? fallback : JSON.parse(stored) as T;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The workspace remains functional when storage is unavailable.
    }
  }, [key, value]);

  return [value, setValue] as const;
}
