import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { AppShell } from "../shared/AppShell";
import type { DemoState, ProjectMode, ViewId } from "../types";
import {
  getSession,
  type ProjectSummary,
  type SessionUser,
} from "../lib/api";
import { Icon } from "../shared/Icon";
import {
  buildViewSearch,
  resolveEntryIntent,
  resolveRootSurface,
  type SessionPhase,
  type WorkspaceEntry,
} from "../features/marketing/entryState";

const LandingPage = lazy(() => import("../features/marketing/LandingPage"));
const AuthGateway = lazy(() => import("../features/auth/AuthGateway"));
const SessionSecurity = lazy(() => import("../features/auth/SessionSecurity"));
const BillingPortal = lazy(() => import("../features/billing/BillingPortal"));
const AdminPanel = lazy(() => import("../features/admin/AdminPanel"));
const UnauthorizedView = lazy(() => import("../features/admin/UnauthorizedView"));
const Dashboard = lazy(() =>
  import("../features/dashboard/Dashboard").then(({ Dashboard: component }) => ({
    default: component,
  })),
);
const ProjectsView = lazy(() =>
  import("../features/projects/ProjectsView").then(
    ({ ProjectsView: component }) => ({ default: component }),
  ),
);
const Workspace = lazy(() =>
  import("../features/workspace/Workspace").then(({ Workspace: component }) => ({
    default: component,
  })),
);
const ExportsView = lazy(() =>
  import("../features/exports/ExportsView").then(
    ({ ExportsView: component }) => ({ default: component }),
  ),
);
const HelpView = lazy(() =>
  import("../features/system/HelpView").then(({ HelpView: component }) => ({
    default: component,
  })),
);
const SettingsView = lazy(() =>
  import("../features/system/SettingsView").then(
    ({ SettingsView: component }) => ({ default: component }),
  ),
);
const MOBILE_SHELL_QUERY = "(max-width: 900px)";

function FeatureLoading() {
  return (
    <div className="feature-loading" role="status" aria-live="polite">
      <i />
      <strong>جارٍ تجهيز الوحدة…</strong>
      <span>يتم تحميل هذا الجزء عند الحاجة فقط.</span>
    </div>
  );
}

function SessionSplash() {
  return (
    <div className="session-splash" role="status" aria-live="polite">
      <div className="session-splash__content">
        <span className="session-splash__mark" aria-hidden="true">
          <Icon name="layers" size={27} />
        </span>
        <strong>جارٍ فتح MotionPrep…</strong>
        <small>نتحقق من الجلسة قبل اختيار مساحة العمل المناسبة.</small>
      </div>
    </div>
  );
}

export function App() {
  const [entryIntent] = useState(() =>
    resolveEntryIntent(window.location.search),
  );
  const [showDemoStateControls] = useState(
    () =>
      import.meta.env.DEV &&
      new URLSearchParams(window.location.search).get("debugStates") === "1",
  );
  const [view, setView] = useState<ViewId>(entryIntent.initialView);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [sessionPhase, setSessionPhase] =
    useState<SessionPhase>("checking");
  const [authOpen, setAuthOpen] = useState(entryIntent.passwordReset);
  const [guestStudioOpen, setGuestStudioOpen] = useState(false);
  const [projectMode, setProjectMode] = useState<ProjectMode>(
    entryIntent.workspace.mode,
  );
  const [workspaceProject, setWorkspaceProject] = useState<Pick<
    ProjectSummary,
    | "id"
    | "name"
    | "currentSourceVersionId"
    | "currentSourceVersionNumber"
  > | null>(entryIntent.workspace.project);
  const [demoState, setDemoState] = useState<DemoState>("ready");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [lightTheme, setLightTheme] = useState(() => {
    try {
      return window.localStorage.getItem("motionprep.settings.light-theme") !==
        "false";
    } catch {
      return true;
    }
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_SHELL_QUERY).matches);
  const openAuth = useCallback(() => {
    setMobileNavOpen(false);
    setAuthOpen(true);
  }, []);

  useEffect(() => {
    void getSession()
      .then((user) => {
        setSessionUser(user);
        setSessionPhase("resolved");
      })
      .catch(() => {
        setNotice("تعذر التحقق من جلسة الخادم.");
        setSessionPhase("resolved");
      });
  }, []);

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
      // Theme remains usable when local storage is unavailable.
    }
  }, [lightTheme]);

  useEffect(() => {
    try {
      const reducedMotion = JSON.parse(
        window.localStorage.getItem("motionprep.settings.reduced-motion") ??
          "false",
      ) as boolean;
      document.documentElement.dataset.motion = reducedMotion
        ? "reduced"
        : "full";
    } catch {
      document.documentElement.dataset.motion = "full";
    }
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const restoreLocation = () => {
      const intent = resolveEntryIntent(window.location.search);
      setView(intent.initialView);
      setProjectMode(intent.workspace.mode);
      setWorkspaceProject(intent.workspace.project);
    };
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, []);

  const navigateView = (
    nextView: ViewId,
    workspace?: WorkspaceEntry,
    replace = false,
  ) => {
    setView(nextView);
    const search = buildViewSearch(
      window.location.search,
      nextView,
      workspace ??
        (nextView === "workspace"
          ? { mode: projectMode, project: workspaceProject }
          : undefined),
    );
    const nextUrl = `${window.location.pathname}${search}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history[replace ? "replaceState" : "pushState"](
        null,
        "",
        nextUrl,
      );
    }
  };

  const openWorkspace = (
    mode: ProjectMode,
    project?: Pick<
      ProjectSummary,
      | "id"
      | "name"
      | "currentSourceVersionId"
      | "currentSourceVersionNumber"
    >,
  ) => {
    setProjectMode(mode);
    setWorkspaceProject(project ?? null);
    setDemoState("ready");
    navigateView("workspace", {
      mode,
      project: project ?? null,
    });
  };

  const role = sessionUser?.role ?? "creator";
  const authenticated = sessionUser !== null;
  const rootSurface = resolveRootSurface({
    sessionPhase,
    authenticated,
    guestStudioOpen,
    authOpen,
    billingReturn: entryIntent.billingReturn,
  });

  if (rootSurface === "auth") {
    return (
      <Suspense fallback={<FeatureLoading />}>
        <AuthGateway
          onAuthenticated={() => {
            void getSession().then((user) => {
              setSessionUser(user);
              setGuestStudioOpen(false);
              setAuthOpen(false);
              setMobileNavOpen(false);
              setNotice("تم فتح جلسة آمنة بنجاح");
            }).catch(() => {
              setNotice("تم الدخول، لكن تعذر تحديث بيانات الجلسة.");
            });
          }}
          onBack={() => setAuthOpen(false)}
        />
      </Suspense>
    );
  }

  if (rootSurface === "splash") {
    return <SessionSplash />;
  }

  if (rootSurface === "marketing") {
    return (
      <Suspense fallback={<SessionSplash />}>
        <LandingPage
          onOpenGuest={() => {
            setGuestStudioOpen(true);
            navigateView("dashboard");
          }}
          onOpenAuth={openAuth}
        />
      </Suspense>
    );
  }

  if (view === "admin") {
    if (role === "creator") {
      return (
        <Suspense fallback={<FeatureLoading />}>
          <UnauthorizedView
            role={role}
            onReturn={() => navigateView("dashboard")}
          />
        </Suspense>
      );
    }
    return (
      <Suspense fallback={<FeatureLoading />}>
        <AdminPanel
          role={role}
          onExit={() => navigateView("dashboard")}
          onNotify={setNotice}
        />
        {notice && <div className="toast" role="status" aria-live="polite"><IconCheck />{notice}</div>}
      </Suspense>
    );
  }

  return (
    <AppShell
      activeView={view}
      mobileNavOpen={mobileNavOpen}
      isMobile={isMobile}
      lightTheme={lightTheme}
      demoState={demoState}
      role={role}
      user={sessionUser}
      onNavigate={(nextView) => {
        navigateView(nextView);
        setMobileNavOpen(false);
      }}
      onToggleMobile={() => setMobileNavOpen((value) => !value)}
      onToggleTheme={() => setLightTheme((value) => !value)}
      onDemoStateChange={setDemoState}
      showDemoStateControls={showDemoStateControls}
      onOpenAuth={openAuth}
    >
      <Suspense fallback={<FeatureLoading />}>
      {view === "dashboard" && (
        <Dashboard
          onOpenWorkspace={openWorkspace}
          onNavigateProjects={() => navigateView("projects")}
        />
      )}
      {view === "projects" && (
        <ProjectsView
          demoState={demoState}
          authenticated={authenticated}
          onRequireAuth={openAuth}
          onOpenWorkspace={openWorkspace}
        />
      )}
      {view === "workspace" && (
        <Workspace
          mode={projectMode}
          authenticated={authenticated}
          onRequireAuth={openAuth}
          onModeChange={(nextMode) => {
            setWorkspaceProject(null);
            setProjectMode(nextMode);
            navigateView(
              "workspace",
              { mode: nextMode, project: null },
              true,
            );
          }}
          initialProject={workspaceProject}
          onBack={() => navigateView("dashboard")}
          onNotify={setNotice}
        />
      )}
      {view === "exports" && (
        <ExportsView
          authenticated={authenticated}
          onRequireAuth={openAuth}
          onCreateProject={() => openWorkspace("image")}
          onViewProjects={() => navigateView("projects")}
          onNotify={setNotice}
        />
      )}
      {view === "billing" && (
        <Suspense fallback={<FeatureLoading />}>
          <BillingPortal
            authenticated={authenticated}
            onRequireAuth={openAuth}
            onNotify={setNotice}
          />
        </Suspense>
      )}
      {view === "security" && <Suspense fallback={<FeatureLoading />}><SessionSecurity user={sessionUser} onOpenAuth={openAuth} onSessionEnded={() => {
        setSessionUser(null);
        setGuestStudioOpen(false);
        navigateView("dashboard");
      }} onNotify={setNotice} /></Suspense>}
      {view === "settings" && (
        <SettingsView
          lightTheme={lightTheme}
          onToggleTheme={() => setLightTheme((value) => !value)}
          onNotify={setNotice}
        />
      )}
      {view === "help" && <HelpView />}
      </Suspense>
      {notice && <div className="toast" role="status" aria-live="polite"><IconCheck />{notice}</div>}
    </AppShell>
  );
}

function IconCheck() {
  return <span aria-hidden="true">✓</span>;
}
