import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
} from "react";
import { AppShell } from "../shared/AppShell";
import type { DemoState, ProjectMode } from "../types";
import type { ProjectSummary } from "../lib/api";
import { Icon } from "../shared/Icon";
import { resolveEntryIntent, resolveRootSurface } from "../features/marketing/entryState";
import { useApplicationLifecycle } from "./useApplicationLifecycle";
import { useAppDisplayPreferences } from "./useAppDisplayPreferences";
import { useGuardedAppNavigation } from "./useGuardedAppNavigation";

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
function FeatureLoading() {
  return (
    <div className="feature-loading" role="status" aria-live="polite">
      <i />
      <strong>جارٍ تجهيز الوحدة…</strong>
      <span>يتم تحميل هذا الجزء عند الحاجة فقط.</span>
    </div>
  );
}

function SessionSplash({ onRetry }: { onRetry?: () => void } = {}) {
  const unavailable = Boolean(onRetry);
  return (
    <div
      className="session-splash"
      role={unavailable ? "alert" : "status"}
    >
      <div className="session-splash__content">
        <span className="session-splash__mark">
          <Icon name={unavailable ? "warning" : "layers"} />
        </span>
        <strong>{unavailable ? "تعذر الاتصال" : "جارٍ فتح MotionPrep…"}</strong>
        {!unavailable && <small>نتحقق من الجلسة قبل فتح مساحة العمل.</small>}
        {onRetry && <button type="button" className="button button--primary" onClick={onRetry}>إعادة المحاولة</button>}
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
  const [notice, setNotice] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(entryIntent.passwordReset);
  const [guestStudioOpen, setGuestStudioOpen] = useState(false);
  const [demoState, setDemoState] = useState<DemoState>("ready");
  const {
    sessionUser,
    sessionPhase,
    capabilities,
    capabilitiesPhase,
    capabilitiesErrorRequestId,
    refreshSession,
    refreshCapabilities,
    refreshSessionAfterAuthentication,
    clearSession,
  } = useApplicationLifecycle(setNotice);
  const {
    view,
    projectMode,
    workspaceProject,
    navigateView,
    registerWorkspaceNavigationGuard,
  } = useGuardedAppNavigation(entryIntent);
  const {
    mobileNavOpen,
    lightTheme,
    isMobile,
    closeMobileNavigation,
    toggleMobileNavigation,
    toggleTheme,
  } = useAppDisplayPreferences(view);
  const openAuth = useCallback(() => {
    closeMobileNavigation();
    setAuthOpen(true);
  }, [closeMobileNavigation]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [notice]);

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
            void refreshSessionAfterAuthentication().then((refreshed) => {
              if (!refreshed) return;
              setGuestStudioOpen(false);
              setAuthOpen(false);
              closeMobileNavigation();
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

  if (rootSurface === "session-unavailable") {
    return <SessionSplash onRetry={() => void refreshSession()} />;
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
        closeMobileNavigation();
      }}
      onToggleMobile={toggleMobileNavigation}
      onToggleTheme={toggleTheme}
      onDemoStateChange={setDemoState}
      showDemoStateControls={showDemoStateControls}
      onOpenAuth={openAuth}
    >
      {capabilitiesPhase === "loading" && (
        <div className="capabilities-health-banner" role="status">
          <span>جاري التحقق من قدرات الخادم وحدود الرفع…</span>
        </div>
      )}
      {capabilitiesPhase === "error" && (
        <div className="capabilities-health-banner" role="alert">
          <span>
            تعذر التحقق من حدود الخادم؛ أوقفت الأدوات والرفع مؤقتًا لحماية
            البيانات.
          </span>
          {capabilitiesErrorRequestId && (
            <code dir="ltr">Request ID: {capabilitiesErrorRequestId}</code>
          )}
          <button
            type="button"
            onClick={() => void refreshCapabilities()}
          >
            إعادة المحاولة
          </button>
        </div>
      )}
      {capabilitiesPhase === "ready" &&
        capabilities.runtime.storageProfile === "ephemeral" && (
          <div className="capabilities-health-banner" role="status">
            <span>
              بيئة تطوير بذاكرة مؤقتة: قد تُفقد الجلسات والمشاريع عند إعادة تشغيل API. استخدم <code dir="ltr">npm run dev:durable</code> للعمل المستمر.
            </span>
          </div>
        )}
      <Suspense fallback={<FeatureLoading />}>
      {view === "dashboard" && (
        <Dashboard
          onOpenWorkspace={openWorkspace}
          onNavigateProjects={() => navigateView("projects")}
          onNavigateExports={() => navigateView("exports")}
          authenticated={authenticated}
          onRequireAuth={openAuth}
          onOpenActivityProject={(item) =>
            openWorkspace(item.project.kind, {
              id: item.project.id,
              name: item.project.name,
              currentSourceVersionId: item.sourceVersionId,
              currentSourceVersionNumber: null,
            })
          }
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
          capabilities={capabilities}
          authenticated={authenticated}
          onRequireAuth={openAuth}
          onModeChange={(nextMode) => {
            return navigateView(
              "workspace",
              { mode: nextMode, project: null },
              true,
            );
          }}
          initialProject={workspaceProject}
          onBack={() => navigateView("dashboard")}
          onNavigationGuardChange={registerWorkspaceNavigationGuard}
          onNotify={setNotice}
        />
      )}
      {view === "exports" && (
        <ExportsView
          authenticated={authenticated}
          onRequireAuth={openAuth}
          onCreateProject={() => openWorkspace("image")}
          onViewProjects={() => navigateView("projects")}
          onOpenProject={(project) =>
            openWorkspace(project.kind, {
              id: project.id,
              name: project.name,
              currentSourceVersionId: project.currentSourceVersionId,
              currentSourceVersionNumber: project.currentSourceVersionNumber,
            })
          }
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
        clearSession();
        setGuestStudioOpen(false);
        navigateView("dashboard");
      }} onNotify={setNotice} /></Suspense>}
      {view === "settings" && (
        <SettingsView
          authenticated={authenticated}
          lightTheme={lightTheme}
          onToggleTheme={toggleTheme}
          onRequireAuth={openAuth}
          onNotify={setNotice}
          onSessionEnded={() => {
            clearSession();
            setGuestStudioOpen(false);
            navigateView("dashboard");
          }}
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
