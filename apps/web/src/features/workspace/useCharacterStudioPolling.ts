import { useEffect } from "react";
import {
  getCharacterRigStudio,
  type CharacterRigStudioState,
} from "../../lib/api/character-rig-client";

interface CharacterStudioPollingOptions {
  projectId: string;
  active: boolean;
  onState: (state: CharacterRigStudioState) => void;
  onInitialError: (error: unknown) => void;
  onLoadingChange: (loading: boolean) => void;
}

export function useCharacterStudioPolling({
  projectId,
  active,
  onState,
  onInitialError,
  onLoadingChange,
}: CharacterStudioPollingOptions): void {
  useEffect(() => {
    const controller = new AbortController();
    void getCharacterRigStudio(projectId, controller.signal)
      .then(onState)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) onInitialError(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) onLoadingChange(false);
      });
    return () => controller.abort();
  }, [onInitialError, onLoadingChange, onState, projectId]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1_500;
    const schedule = (delay: number) => {
      timer = setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (document.visibilityState === "hidden") {
        schedule(5_000);
        return;
      }
      try {
        onState(await getCharacterRigStudio(projectId, controller.signal));
        retryDelay = 1_500;
      } catch {
        if (controller.signal.aborted) return;
        retryDelay = Math.min(retryDelay * 2, 15_000);
      }
      if (!controller.signal.aborted) schedule(retryDelay);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      void poll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule(retryDelay);
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active, onState, projectId]);
}
