import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import type { DemoState, UserRole, ViewId } from "../types";
import type { SessionUser } from "../lib/api";

interface NavItem {
  id: ViewId;
  label: string;
  icon: IconName;
}

const navigation: NavItem[] = [
  { id: "dashboard", label: "الرئيسية", icon: "home" },
  { id: "projects", label: "المشاريع", icon: "folder" },
  { id: "exports", label: "التصديرات", icon: "download" },
  { id: "billing", label: "الفوترة", icon: "creditCard" },
  { id: "settings", label: "الإعدادات", icon: "settings" },
  { id: "help", label: "المساعدة", icon: "help" },
];

const viewTitles: Record<ViewId, string> = {
  dashboard: "الرئيسية",
  projects: "المشاريع",
  workspace: "مساحة التجهيز",
  exports: "التصديرات",
  billing: "الفوترة والاستخدام",
  security: "الحساب والأمان",
  admin: "مركز الإدارة",
  settings: "الإعدادات",
  help: "المساعدة",
};

interface AppShellProps {
  activeView: ViewId;
  mobileNavOpen: boolean;
  isMobile: boolean;
  lightTheme: boolean;
  demoState: DemoState;
  role: UserRole;
  user: SessionUser | null;
  onNavigate: (view: ViewId) => void;
  onOpenAuth: () => void;
  onToggleMobile: () => void;
  onToggleTheme: () => void;
  onDemoStateChange: (state: DemoState) => void;
  showDemoStateControls?: boolean;
  children: ReactNode;
}

function NavButton({ item, active, onSelect }: { item: NavItem; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={`nav-item ${active ? "is-active" : ""}`}
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      title={item.label}
    >
      <Icon name={item.icon} size={19} />
      <span>{item.label}</span>
    </button>
  );
}

export function AppShell({
  activeView,
  mobileNavOpen,
  isMobile,
  lightTheme,
  demoState,
  role,
  user,
  onNavigate,
  onOpenAuth,
  onToggleMobile,
  onToggleTheme,
  onDemoStateChange,
  showDemoStateControls = false,
  children,
}: AppShellProps) {
  const drawerId = useId();
  const drawerRef = useRef<HTMLElement>(null);
  const appMainRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const onToggleMobileRef = useRef(onToggleMobile);
  onToggleMobileRef.current = onToggleMobile;
  const visibleNavigation =
    role === "creator"
      ? navigation
      : [...navigation, { id: "admin" as const, label: "مركز الإدارة", icon: "shield" as const }];

  useEffect(() => {
    if (!isMobile || !mobileNavOpen) return;
    const drawer = drawerRef.current;
    const appMain = appMainRef.current;
    const previousOverflow = document.body.style.overflow;
    const previousAriaHidden = appMain?.getAttribute("aria-hidden") ?? null;
    const appMainHadInert = appMain?.hasAttribute("inert") ?? false;
    document.body.style.overflow = "hidden";
    appMain?.setAttribute("inert", "");
    appMain?.setAttribute("aria-hidden", "true");

    const frame = window.requestAnimationFrame(() => {
      drawer
        ?.querySelector<HTMLElement>("[data-drawer-initial-focus]")
        ?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onToggleMobileRef.current();
        return;
      }
      if (event.key !== "Tab" || !drawer) return;
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        drawer.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (!appMainHadInert) appMain?.removeAttribute("inert");
      if (previousAriaHidden === null) appMain?.removeAttribute("aria-hidden");
      else appMain?.setAttribute("aria-hidden", previousAriaHidden);
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    };
  }, [isMobile, mobileNavOpen]);

  return (
    <div className={`app-shell app-shell--${activeView}`}>
      {mobileNavOpen && (
        <button className="nav-scrim" type="button" tabIndex={-1} onClick={onToggleMobile} aria-label="إغلاق القائمة" aria-hidden="true" />
      )}

      {(!isMobile || mobileNavOpen) && (
        <aside
          ref={drawerRef}
          id={drawerId}
          className={`sidebar ${mobileNavOpen ? "is-mobile-open" : ""}`}
          aria-label="التنقل الرئيسي"
          role={isMobile ? "dialog" : undefined}
          aria-modal={isMobile ? true : undefined}
          tabIndex={isMobile ? -1 : undefined}
        >
          <div className="brand">
            <span className="brand-mark" aria-hidden="true"><Icon name="layers" size={20} /></span>
            <span className="brand-copy">
              <strong>MotionPrep</strong>
              <small>تجهيز أسرع للتحريك</small>
            </span>
            <button className="icon-button sidebar-close" type="button" onClick={onToggleMobile} aria-label="إغلاق القائمة" data-drawer-initial-focus>
              <Icon name="close" />
            </button>
          </div>

          <nav className="nav-list">
            {visibleNavigation.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={activeView === item.id}
                onSelect={() => onNavigate(item.id)}
              />
            ))}
          </nav>

          <div className="sidebar-note">
            <Icon name="server" size={17} />
            <div>
              <strong>مسار إنتاج متصل</strong>
              <span>الرفع والمعالجة والتصدير تنفذ عبر الخادم وتحفظ حالة المشروع.</span>
            </div>
          </div>

          <button type="button" className="profile" onClick={() => user ? onNavigate("security") : onOpenAuth()} aria-label={user ? "فتح إعدادات الحساب والأمان" : "تسجيل الدخول"}>
            <span className="avatar">{user?.name.slice(0, 1) ?? "ض"}</span>
            <span><strong>{user?.name ?? "ضيف"}</strong><small>{user ? role : "سجل الدخول لحفظ مشاريعك"}</small></span>
            <Icon name="chevron" size={14} />
          </button>
        </aside>
      )}

      <section ref={appMainRef} className="app-main">
        <header className="topbar">
          <div className="topbar-leading">
            <button
              ref={menuButtonRef}
              className="icon-button mobile-menu"
              type="button"
              onClick={onToggleMobile}
              aria-label="فتح القائمة"
              aria-expanded={mobileNavOpen}
              aria-controls={drawerId}
            >
              <Icon name="menu" />
            </button>
            <div>
              <span className="topbar-brand-mobile">MotionPrep</span>
              <strong>{viewTitles[activeView]}</strong>
            </div>
          </div>

          <div className="topbar-actions">
            {showDemoStateControls && <label className="demo-select">
              <span className="demo-dot" />
              <span>اختبار الحالات</span>
              <select
                value={demoState}
                onChange={(event) => onDemoStateChange(event.target.value as DemoState)}
                aria-label="حالة بيانات العرض"
              >
                <option value="ready">جاهز</option>
                <option value="loading">تحميل</option>
                <option value="empty">فارغ</option>
                <option value="error">خطأ</option>
              </select>
            </label>}
            {role !== "creator" && <button className="help-button" type="button" onClick={() => onNavigate("admin")}><Icon name="shield" size={17} /><span>الإدارة</span></button>}
            <button
              className="icon-button"
              type="button"
              onClick={onToggleTheme}
              aria-label={lightTheme ? "استخدام السمة الداكنة" : "استخدام السمة الفاتحة"}
              title={lightTheme ? "السمة الداكنة" : "السمة الفاتحة"}
            >
              <Icon name={lightTheme ? "moon" : "sun"} size={18} />
            </button>
            <button className="help-button" type="button" onClick={() => onNavigate("help")}>
              <Icon name="help" size={18} /><span>مساعدة</span>
            </button>
            <button className="help-button account-button" type="button" onClick={() => user ? onNavigate("security") : onOpenAuth()}>
              <Icon name={user ? "shieldCheck" : "login"} size={17} /><span>{user ? "الحساب" : "تسجيل الدخول"}</span>
            </button>
          </div>
        </header>

        <main className={activeView === "workspace" ? "page-content is-workspace" : "page-content"}>{children}</main>
      </section>

      {isMobile && !mobileNavOpen && activeView !== "workspace" && (
        <nav className="mobile-bottom-nav" aria-label="التنقل السريع">
          {visibleNavigation.filter((item) => ["dashboard", "projects", "exports", "settings"].includes(item.id)).map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={activeView === item.id}
              onSelect={() => onNavigate(item.id)}
            />
          ))}
        </nav>
      )}
    </div>
  );
}
