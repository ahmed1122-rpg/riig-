import type { ViewId } from "../../types";

export type SessionPhase = "checking" | "resolved" | "unavailable";
export type RootSurface =
  | "auth"
  | "splash"
  | "session-unavailable"
  | "marketing"
  | "studio";

const viewIds: readonly ViewId[] = [
  "dashboard",
  "projects",
  "workspace",
  "exports",
  "billing",
  "security",
  "admin",
  "help",
  "settings",
];

export interface WorkspaceEntry {
  mode: "image" | "book";
  project: {
    id: string;
    name: string;
    currentSourceVersionId: string | null;
    currentSourceVersionNumber: number | null;
  } | null;
}

export interface EntryIntent {
  initialView: ViewId;
  billingReturn: boolean;
  passwordReset: boolean;
  workspace: WorkspaceEntry;
}

export function resolveEntryIntent(search: string): EntryIntent {
  const query = new URLSearchParams(search);
  const billingReturn =
    query.has("billingReturn") ||
    query.has("sandbox_checkout") ||
    query.has("payment");
  const requestedView = query.get("view");
  const initialView =
    !billingReturn &&
    requestedView &&
    viewIds.includes(requestedView as ViewId)
      ? (requestedView as ViewId)
      : billingReturn
        ? "billing"
        : "dashboard";
  const sourceVersionNumber = Number(query.get("sourceVersion"));
  const projectId = query.get("projectId");

  return {
    initialView,
    billingReturn,
    passwordReset: query.has("token"),
    workspace: {
      mode: query.get("mode") === "book" ? "book" : "image",
      project: projectId
        ? {
            id: projectId,
            name: query.get("projectName") || "مشروع",
            currentSourceVersionId: query.get("sourceVersionId"),
            currentSourceVersionNumber:
              Number.isInteger(sourceVersionNumber) &&
              sourceVersionNumber > 0
                ? sourceVersionNumber
                : null,
          }
        : null,
    },
  };
}

export function buildViewSearch(
  currentSearch: string,
  view: ViewId,
  workspace?: WorkspaceEntry,
): string {
  const query = new URLSearchParams(currentSearch);
  for (const key of [
    "billingReturn",
    "sandbox_checkout",
    "payment",
    "checkout_id",
    "provider",
    "session_id",
    "token",
  ]) {
    query.delete(key);
  }
  query.set("view", view);

  for (const key of [
    "mode",
    "projectId",
    "projectName",
    "sourceVersionId",
    "sourceVersion",
  ]) {
    query.delete(key);
  }
  if (view === "workspace" && workspace) {
    query.set("mode", workspace.mode);
    if (workspace.project) {
      query.set("projectId", workspace.project.id);
      query.set("projectName", workspace.project.name);
      if (workspace.project.currentSourceVersionId) {
        query.set(
          "sourceVersionId",
          workspace.project.currentSourceVersionId,
        );
      }
      if (workspace.project.currentSourceVersionNumber) {
        query.set(
          "sourceVersion",
          String(workspace.project.currentSourceVersionNumber),
        );
      }
    }
  }

  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

export function resolveRootSurface(input: {
  sessionPhase: SessionPhase;
  authenticated: boolean;
  guestStudioOpen: boolean;
  authOpen: boolean;
  billingReturn: boolean;
}): RootSurface {
  if (input.authOpen) return "auth";
  if (input.sessionPhase === "checking") return "splash";
  if (input.sessionPhase === "unavailable") return "session-unavailable";
  if (
    !input.authenticated &&
    !input.guestStudioOpen &&
    !input.billingReturn
  ) {
    return "marketing";
  }
  return "studio";
}
