import { useCallback, useEffect, useState } from "react";
import type { ViewId } from "../types";

const MOBILE_SHELL_QUERY = "(max-width: 900px)";

export function readStoredLightTheme(storage: Pick<Storage, "getItem">): boolean {
  try {
    return storage.getItem("motionprep.settings.light-theme") !== "false";
  } catch {
    return true;
  }
}

export function readStoredReducedMotion(
  storage: Pick<Storage, "getItem">,
): boolean {
  try {
    return JSON.parse(
      storage.getItem("motionprep.settings.reduced-motion") ?? "false",
    ) as boolean;
  } catch {
    return false;
  }
}

export function useAppDisplayPreferences(view: ViewId) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [lightTheme, setLightTheme] = useState(() =>
    readStoredLightTheme(window.localStorage),
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
    try {
      window.localStorage.setItem(
        "motionprep.settings.light-theme",
        String(lightTheme),
      );
    } catch {
      // The in-memory preference remains usable when storage is unavailable.
    }
  }, [lightTheme]);

  useEffect(() => {
    if (view === "workspace") return;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [view]);

  useEffect(() => {
    document.documentElement.dataset.motion = readStoredReducedMotion(
      window.localStorage,
    )
      ? "reduced"
      : "full";
  }, []);

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
