import type { ViewId } from "../types";
import {
  buildViewSearch,
  type WorkspaceEntry,
} from "../features/marketing/entryState";

export function appLocation(pathname: string, search: string): string {
  return `${pathname}${search}`;
}

export function buildAppViewLocation(input: {
  pathname: string;
  currentSearch: string;
  nextView: ViewId;
  workspace?: WorkspaceEntry;
}): string {
  return `${input.pathname}${buildViewSearch(
    input.currentSearch,
    input.nextView,
    input.workspace,
  )}`;
}

export function workspaceEntryForView(
  nextView: ViewId,
  requested: WorkspaceEntry | undefined,
  current: WorkspaceEntry,
): WorkspaceEntry | undefined {
  if (requested) return requested;
  return nextView === "workspace" ? current : undefined;
}
