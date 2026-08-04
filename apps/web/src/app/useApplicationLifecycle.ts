import { useCallback, useEffect, useState } from "react";
import {
  getApplicationCapabilities,
  getSession,
  unavailableApplicationCapabilities,
  type ApplicationCapabilities,
  type SessionUser,
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

  useEffect(() => {
    let active = true;
    void getApplicationCapabilities()
      .then((value) => {
        if (active) setCapabilities(value);
      })
      .catch(() => {
        if (active) setCapabilities(unavailableApplicationCapabilities);
      });
    return () => {
      active = false;
    };
  }, []);

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
    refreshSessionAfterAuthentication,
    clearSession,
  };
}
