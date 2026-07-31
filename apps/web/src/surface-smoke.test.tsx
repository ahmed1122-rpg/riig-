import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "./shared/AppShell";
import AuthGateway from "./features/auth/AuthGateway";
import AdminPanel from "./features/admin/AdminPanel";
import UnauthorizedView from "./features/admin/UnauthorizedView";
import { ProjectsView } from "./features/projects/ProjectsView";
import { ExportsView } from "./features/exports/ExportsView";

const noop = () => undefined;

describe("production application surfaces", () => {
  it("renders the authenticated application shell and privileged navigation", () => {
    const markup = renderToStaticMarkup(
      <AppShell
        activeView="projects"
        mobileNavOpen={false}
        isMobile={false}
        lightTheme
        demoState="ready"
        role="admin"
        user={{
          id: "00000000-0000-4000-8000-000000000001",
          name: "Admin",
          email: "admin@example.test",
          role: "admin",
          mfaEnabled: true,
        }}
        onNavigate={noop}
        onOpenAuth={noop}
        onToggleMobile={noop}
        onToggleTheme={noop}
        onDemoStateChange={noop}
      >
        <p>shell-content</p>
      </AppShell>,
    );

    expect(markup).toContain("shell-content");
    expect(markup).toContain("app-shell--projects");
    expect(markup).toContain("admin");
  });

  it("renders login, authorization denial, and admin loading boundaries", () => {
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { search: "" } },
    });
    try {
      const login = renderToStaticMarkup(
        <AuthGateway onAuthenticated={noop} onBack={noop} />,
      );
      const denied = renderToStaticMarkup(
        <UnauthorizedView role="creator" onReturn={noop} />,
      );
      const admin = renderToStaticMarkup(
        <AdminPanel role="admin" onExit={noop} onNotify={noop} />,
      );

      expect(login).toContain("auth-gateway");
      expect(denied).toContain("unauthorized-page");
      expect(admin).toContain("admin-shell");
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  });

  it("renders guest-safe projects and exports states", () => {
    const projects = renderToStaticMarkup(
      <ProjectsView
        demoState="empty"
        authenticated={false}
        onRequireAuth={noop}
        onOpenWorkspace={noop}
      />,
    );
    const exports = renderToStaticMarkup(
      <ExportsView
        authenticated={false}
        onRequireAuth={noop}
        onCreateProject={noop}
        onViewProjects={noop}
      />,
    );

    expect(projects).toContain("projects-view");
    expect(exports).toContain("projects-view");
  });
});
