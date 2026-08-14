import type { ProjectMode } from "../../types";

export async function commitWorkspaceModeChange(
  currentMode: ProjectMode,
  nextMode: ProjectMode,
  navigate: (mode: ProjectMode) => Promise<boolean>,
  commitLocalState: (mode: ProjectMode) => void,
): Promise<boolean> {
  if (nextMode === currentMode) return false;
  const changed = await navigate(nextMode);
  if (!changed) return false;
  commitLocalState(nextMode);
  return true;
}
