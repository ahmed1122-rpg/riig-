import { useRef } from "react";
import {
  getCharacterRigStudio,
  type CharacterRigStudioState,
} from "../../lib/api/character-rig-client";
import { useResourcePolling } from "../../shared/hooks/useResourcePolling";

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
  const initialSettled = useRef<{ projectId: string; settled: boolean }>({
    projectId,
    settled: false,
  });
  if (initialSettled.current.projectId !== projectId) {
    initialSettled.current = { projectId, settled: false };
  }

  useResourcePolling({
    enabled: true,
    resourceKey: `character-studio:${projectId}`,
    revision: active ? 1 : 0,
    intervalMs: 1_500,
    maximumRetryIntervalMs: 15_000,
    load: (signal) => getCharacterRigStudio(projectId, signal),
    shouldPoll: () => active,
    onSuccess: (state) => {
      initialSettled.current.settled = true;
      onState(state);
      onLoadingChange(false);
    },
    onError: (error) => {
      if (!initialSettled.current.settled) {
        initialSettled.current.settled = true;
        onInitialError(error);
      }
      onLoadingChange(false);
    },
  });
}
