import { useCallback, useEffect, useState } from "react";
import {
  readStoredPreference,
  useStoredPreference,
} from "../shared/useStoredPreference";
import type { ViewId } from "../types";

const MOBILE_SHELL_QUERY = "(max-width: 900px)";

export function readStoredLightTheme(storage: Pick<Storage, "getItem">): boolean {
  return readStoredPreference(
    storage,
    "motionprep.settings.light-theme",
    true,
  );
}

export function readStoredReducedMotion(
  storage: Pick<Storage, "getItem">,
): boolean {
  return readStoredPreference(
    storage,
    "motionprep.settings.reduced-motion",
    false,
  );
}

export function useAppDisplayPreferences(view: ViewId) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [lightTheme, setLightTheme] = useStoredPreference(
    "motionprep.settings.light-theme",
    true,
  );
  const [reducedMotion] = useStoredPreference(
    "motionprep.settings.reduced-motion",
    false,
  );
  const [isMobile, setIsMobile] = useState(() =>
    window.matchMedia(MOBILE_SHELL_QUERY).matches,
  );

  useEffect(() => {
    const mobileQuery = window.matchMedia(MOBILE_SHELL_QUERY);
    const syncViewport = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(event.matches);
      setMobileNavOpen(false);
    };
    syncViewport(mobileQuery);
    mobileQuery.addEventListener("change", syncViewport);
    return () => mobileQuery.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = lightTheme ? "light" : "dark";
  }, [lightTheme]);

  useEffect(() => {
    if (view === "workspace") return;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [view]);

  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? "reduced" : "full";
  }, [reducedMotion]);

  const closeMobileNavigation = useCallback(() => setMobileNavOpen(false), []);
  const toggleMobileNavigation = useCallback(
    () => setMobileNavOpen((value) => !value),
    [],
  );
  const toggleTheme = useCallback(
    () => setLightTheme((value) => !value),
    [],
  );

  return {
    mobileNavOpen,
    lightTheme,
    isMobile,
    closeMobileNavigation,
    toggleMobileNavigation,
    toggleTheme,
  };
}
