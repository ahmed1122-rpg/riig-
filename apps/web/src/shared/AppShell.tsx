import type { ReactNode } from "react";
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
  children,
}: AppShellProps) {
  const visibleNavigation =
    role === "creator"
      ? navigation
      : [...navigation, { id: "admin" as const, label: "مركز الإدارة", icon: "shield" as const }];
  return (
    <div className={`app-shell app-shell--${activeView}`}>
      {mobileNavOpen && (
        <button className="nav-scrim" type="button" onClick={onToggleMobile} aria-label="إغلاق القائمة" />
      )}

      {(!isMobile || mobileNavOpen) && (
        <aside className={`sidebar ${mobileNavOpen ? "is-mobile-open" : ""}`} aria-label="التنقل الرئيسي">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true"><Icon name="layers" size={20} /></span>
            <span className="brand-copy">
              <strong>MotionPrep</strong>
              <small>تجهيز أسرع للتحريك</small>
            </span>
            <button className="icon-button sidebar-close" type="button" onClick={onToggleMobile} aria-label="إغلاق القائمة">
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

      <section className="app-main">
        <header className="topbar">
          <div className="topbar-leading">
            <button className="icon-button mobile-menu" type="button" onClick={onToggleMobile} aria-label="فتح القائمة">
              <Icon name="menu" />
            </button>
            <div>
              <span className="topbar-brand-mobile">MotionPrep</span>
              <strong>{viewTitles[activeView]}</strong>
            </div>
          </div>

          <div className="topbar-actions">
            {import.meta.env.DEV && <label className="demo-select">
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
