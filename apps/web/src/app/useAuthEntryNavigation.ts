import { useCallback, useEffect, useRef, useState } from "react";
import {
  resolveEntryIntent,
  type EntryIntent,
} from "../features/marketing/entryState";

export function useAuthEntryNavigation(entryIntent: EntryIntent) {
  const initialLocationIntent =
    entryIntent.passwordReset || entryIntent.emailVerification;
  const [authOpen, setAuthOpen] = useState(initialLocationIntent);
  const [authEntryRevision, setAuthEntryRevision] = useState(0);
  const locationDrivenRef = useRef(initialLocationIntent);

  useEffect(() => {
    const restoreAuthEntry = () => {
      const intent = resolveEntryIntent(window.location.search);
      const locationIntent = intent.passwordReset || intent.emailVerification;
      if (locationIntent) {
        locationDrivenRef.current = true;
        setAuthOpen(true);
        // Remount AuthGateway when history moves between two callback URLs while
        // the gateway is already open, so it consumes the new token exactly once.
        setAuthEntryRevision((revision) => revision + 1);
        return;
      }
      if (locationDrivenRef.current) {
        locationDrivenRef.current = false;
        setAuthOpen(false);
      }
    };

    window.addEventListener("popstate", restoreAuthEntry);
    return () => window.removeEventListener("popstate", restoreAuthEntry);
  }, []);

  const openAuth = useCallback(() => {
    locationDrivenRef.current = false;
    setAuthOpen(true);
  }, []);

  const closeAuth = useCallback(() => {
    locationDrivenRef.current = false;
    setAuthOpen(false);
  }, []);

  return { authOpen, authEntryRevision, openAuth, closeAuth };
}
