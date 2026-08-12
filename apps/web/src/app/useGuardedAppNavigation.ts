import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectMode, ViewId } from "../types";
import {
  resolveEntryIntent,
  type EntryIntent,
  type WorkspaceEntry,
} from "../features/marketing/entryState";
import {
  appLocation,
  buildAppViewLocation,
  workspaceEntryForView,
} from "./appRouting";

export type WorkspaceNavigationGuard = () => Promise<boolean>;

export function useGuardedAppNavigation(entryIntent: EntryIntent) {
  const [view, setView] = useState<ViewId>(entryIntent.initialView);
  const [projectMode, setProjectMode] = useState<ProjectMode>(
    entryIntent.workspace.mode,
  );
  const [workspaceProject, setWorkspaceProject] = useState<
    WorkspaceEntry["project"]
  >(entryIntent.workspace.project);
  const guardRef = useRef<WorkspaceNavigationGuard | null>(null);
  const sequenceRef = useRef(0);
  const viewRef = useRef(view);
  const committedLocationRef = useRef(
    appLocation(window.location.pathname, window.location.search),
  );
  viewRef.current = view;

  const registerWorkspaceNavigationGuard = useCallback(
    (guard: WorkspaceNavigationGuard | null) => {
      guardRef.current = guard;
    },
    [],
  );

  useEffect(() => {
    const restoreLocation = () => {
      const intent = resolveEntryIntent(window.location.search);
      const requestedLocation = appLocation(
        window.location.pathname,
        window.location.search,
      );
      const applyLocation = () => {
        setView(intent.initialView);
        viewRef.current = intent.initialView;
        setProjectMode(intent.workspace.mode);
        setWorkspaceProject(intent.workspace.project);
        committedLocationRef.current = requestedLocation;
      };
      const guard = viewRef.current === "workspace" ? guardRef.current : null;
      if (!guard) {
        applyLocation();
        return;
      }
      const sequence = ++sequenceRef.current;
      void guard().then((allowed) => {
        if (sequence !== sequenceRef.current) return;
        if (allowed) {
          applyLocation();
          return;
        }
        window.history.pushState(null, "", committedLocationRef.current);
      });
    };
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, []);

  const navigateView = useCallback(
    async (
      nextView: ViewId,
      requestedWorkspace?: WorkspaceEntry,
      replace = false,
    ): Promise<boolean> => {
      const currentWorkspace: WorkspaceEntry = {
        mode: projectMode,
        project: workspaceProject,
      };
      const routeWorkspace = workspaceEntryForView(
        nextView,
        requestedWorkspace,
        currentWorkspace,
      );
      const commitNavigation = () => {
        if (nextView === "workspace" && requestedWorkspace) {
          setProjectMode(requestedWorkspace.mode);
          setWorkspaceProject(requestedWorkspace.project);
        }
        setView(nextView);
        viewRef.current = nextView;
        const nextLocation = buildAppViewLocation({
          pathname: window.location.pathname,
          currentSearch: window.location.search,
          nextView,
          ...(routeWorkspace ? { workspace: routeWorkspace } : {}),
        });
        if (
          appLocation(window.location.pathname, window.location.search) !==
          nextLocation
        ) {
          window.history[replace ? "replaceState" : "pushState"](
            null,
            "",
            nextLocation,
          );
        }
        committedLocationRef.current = nextLocation;
      };
      const guard = viewRef.current === "workspace" ? guardRef.current : null;
      if (!guard) {
        commitNavigation();
        return true;
      }
      const sequence = ++sequenceRef.current;
      const allowed = await guard();
      if (!allowed || sequence !== sequenceRef.current) return false;
      commitNavigation();
      return true;
    },
    [projectMode, workspaceProject],
  );

  return {
    view,
    projectMode,
    workspaceProject,
    navigateView,
    registerWorkspaceNavigationGuard,
  };
}
