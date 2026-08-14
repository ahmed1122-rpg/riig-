export type WorkspaceCommandStatus =
  | { phase: "idle" }
  | { phase: "running"; label: string; progress?: number }
  | { phase: "error"; label: string; message: string };

export function workspaceCommandError(
  label: string,
  error: unknown,
  fallback: string,
): WorkspaceCommandStatus {
  return {
    phase: "error",
    label,
    message: error instanceof Error ? error.message : fallback,
  };
}
