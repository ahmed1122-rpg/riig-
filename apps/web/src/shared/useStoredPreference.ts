import { useEffect, useState } from "react";

export type StoredPreferenceValidator<T> = (value: unknown) => value is T;
type PreferenceListener = (serialized: string | null) => void;
const preferenceListeners = new Map<string, Set<PreferenceListener>>();
let storageListenerAttached = false;

export function readStoredPreference<T>(
  storage: Pick<Storage, "getItem">,
  key: string,
  fallback: T,
  validate: StoredPreferenceValidator<T> = (value): value is T =>
    samePrimitiveType(value, fallback),
): T {
  try {
    return parseStoredPreference(storage.getItem(key), fallback, validate);
  } catch {
    return fallback;
  }
}

export function useStoredPreference<T>(
  key: string,
  fallback: T,
  validate: StoredPreferenceValidator<T> = (value): value is T =>
    samePrimitiveType(value, fallback),
) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return fallback;
    return readStoredPreference(window.localStorage, key, fallback, validate);
  });

  useEffect(() => {
    try {
      const serialized = JSON.stringify(value);
      window.localStorage.setItem(key, serialized);
      publishPreference(key, serialized);
    } catch {
      // The application remains functional when browser storage is unavailable.
    }
  }, [key, value]);

  useEffect(() => {
    const sync = (serialized: string | null) => {
      setValue((current) => {
        const next = parseStoredPreference(serialized, fallback, validate);
        return Object.is(current, next) ? current : next;
      });
    };
    return subscribeToPreference(key, sync);
  }, [fallback, key, validate]);

  return [value, setValue] as const;
}

function subscribeToPreference(
  key: string,
  listener: PreferenceListener,
): () => void {
  const listeners = preferenceListeners.get(key) ?? new Set();
  listeners.add(listener);
  preferenceListeners.set(key, listeners);
  if (!storageListenerAttached) {
    window.addEventListener("storage", onStoragePreferenceChange);
    storageListenerAttached = true;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) preferenceListeners.delete(key);
    if (preferenceListeners.size === 0 && storageListenerAttached) {
      window.removeEventListener("storage", onStoragePreferenceChange);
      storageListenerAttached = false;
    }
  };
}

function onStoragePreferenceChange(event: StorageEvent): void {
  if (event.key) publishPreference(event.key, event.newValue);
}

function publishPreference(key: string, serialized: string | null): void {
  for (const listener of preferenceListeners.get(key) ?? []) {
    listener(serialized);
  }
}

function parseStoredPreference<T>(
  serialized: string | null,
  fallback: T,
  validate: StoredPreferenceValidator<T>,
): T {
  if (serialized === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(serialized);
    return validate(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function samePrimitiveType<T>(value: unknown, fallback: T): value is T {
  if (typeof value !== typeof fallback) return false;
  return typeof value !== "number" || Number.isFinite(value);
}
