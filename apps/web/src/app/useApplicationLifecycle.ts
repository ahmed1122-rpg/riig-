import { useCallback, useEffect, useState } from "react";
import {
  getApplicationCapabilities,
  getSession,
  unavailableApplicationCapabilities,
  type ApplicationCapabilities,
  type SessionUser,
  ApiError,
} from "../lib/api";
import type { SessionPhase } from "../features/marketing/entryState";

export function useApplicationLifecycle(
  onNotify: (message: string) => void,
) {
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [sessionPhase, setSessionPhase] =
    useState<SessionPhase>("checking");
  const [capabilities, setCapabilities] = useState<ApplicationCapabilities>(
    unavailableApplicationCapabilities,
  );
  const [capabilitiesPhase, setCapabilitiesPhase] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [capabilitiesErrorRequestId, setCapabilitiesErrorRequestId] =
    useState<string>();

  useEffect(() => {
    let active = true;
    void getSession()
      .then((user) => {
        if (!active) return;
        setSessionUser(user);
        setSessionPhase("resolved");
      })
      .catch(() => {
        if (!active) return;
        onNotify("تعذر التحقق من جلسة الخادم.");
        setSessionPhase("resolved");
      });
    return () => {
      active = false;
    };
  }, [onNotify]);

  const refreshCapabilities = useCallback(async () => {
    setCapabilitiesPhase("loading");
    setCapabilitiesErrorRequestId(undefined);
    try {
      const value = await getApplicationCapabilities();
      setCapabilities(value);
      setCapabilitiesPhase("ready");
      return true;
    } catch (error) {
      setCapabilities(unavailableApplicationCapabilities);
      setCapabilitiesErrorRequestId(
        error instanceof ApiError ? error.requestId : undefined,
      );
      setCapabilitiesPhase("error");
      return false;
    }
  }, []);

  useEffect(() => {
    void refreshCapabilities();
  }, [refreshCapabilities]);

  const refreshSessionAfterAuthentication = useCallback(async () => {
    try {
      const user = await getSession();
      setSessionUser(user);
      onNotify("تم فتح جلسة آمنة بنجاح");
      return true;
    } catch {
      onNotify("تم الدخول، لكن تعذر تحديث بيانات الجلسة.");
      return false;
    }
  }, [onNotify]);

  const clearSession = useCallback(() => setSessionUser(null), []);

  return {
    sessionUser,
    sessionPhase,
    capabilities,
    capabilitiesPhase,
    capabilitiesErrorRequestId,
    refreshCapabilities,
    refreshSessionAfterAuthentication,
    clearSession,
  };
}
