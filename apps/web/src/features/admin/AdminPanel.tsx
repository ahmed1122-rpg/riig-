import { useEffect, useId, useRef, useState } from "react";
import { useDebounce } from "../../shared/hooks/useDebounce";
import { useMediaQuery } from "../../shared/hooks/useMediaQuery";
import { useModalDrawer } from "../../shared/hooks/useModalDrawer";
import { downloadBlob } from "../../shared/browserDownload";
import {
  ApiError,
  getAdminAudit,
  getAdminBilling,
  getAdminExports,
  getAdminOverview,
  getAdminProcessing,
  getAdminSystem,
  getAdminUsers,
  retryAdminExport,
  retryAdminProcessing,
  updateAdminUserAccess,
  type AdminAuditEvent,
  type AdminBillingData,
  type AdminExportJob,
  type AdminOverview as AdminOverviewData,
  type AdminProcessingJob,
  type AdminSystemStatus,
  type AdminUser,
} from "../../lib/api";
import { Dialog } from "../../shared/Dialog";
import { formatDateTime } from "../../shared/formatters";
import { Icon, type IconName } from "../../shared/Icon";
import type { AdminView, UserRole } from "../../types";
import { Exports, Processing } from "./AdminJobViews";
import {
  DataFeedback,
  outcomeTone,
  Search,
  Status,
} from "./AdminPrimitives";

export { Exports, Processing } from "./AdminJobViews";
export { DataFeedback, outcomeTone, Status } from "./AdminPrimitives";

interface AdminPanelProps {
  role: Exclude<UserRole, "creator">;
  onExit: () => void;
  onNotify: (message: string) => void;
}

interface AdminNavItem {
  id: AdminView;
  label: string;
  icon: IconName;
  roles: UserRole[];
}

type RetryTarget =
  | { kind: "processing"; job: AdminProcessingJob }
  | { kind: "export"; job: AdminExportJob };

const roleLabels: Record<UserRole, string> = {
  creator: "صانع محتوى",
  support: "دعم",
  finance: "مالية",
  admin: "مدير",
};

const accountStatusLabels: Record<AdminUser["status"], string> = {
  active: "نشط",
  pending_verification: "بانتظار التحقق",
  suspended: "موقوف",
};

const navigation: AdminNavItem[] = [
  { id: "overview", label: "نظرة عامة", icon: "gauge", roles: ["support", "finance", "admin"] },
  { id: "processing", label: "المعالجة", icon: "activity", roles: ["support", "admin"] },
  { id: "exports", label: "التصديرات", icon: "download", roles: ["support", "admin"] },
  { id: "users", label: "المستخدمون", icon: "users", roles: ["support", "admin"] },
  { id: "billing", label: "الفوترة", icon: "creditCard", roles: ["finance", "admin"] },
  { id: "audit", label: "سجل التدقيق", icon: "history", roles: ["support", "finance", "admin"] },
  { id: "system", label: "التشغيل", icon: "settings", roles: ["admin"] },
];

function formatDate(value: string | null): string {
  return formatDateTime(value, "لم يسجّل دخوله");
}

export default function AdminPanel({ role, onExit, onNotify }: AdminPanelProps) {
  const drawerId = useId();
  const drawerRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavigation = useMediaQuery("(max-width: 800px)");
  const allowedNavigation = navigation.filter((item) => item.roles.includes(role));
  const [activeView, setActiveView] = useState<AdminView>(allowedNavigation[0]?.id ?? "overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [jobs, setJobs] = useState<AdminProcessingJob[]>([]);
  const [exportJobs, setExportJobs] = useState<AdminExportJob[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [billing, setBilling] = useState<AdminBillingData | null>(null);
  const [audit, setAudit] = useState<AdminAuditEvent[]>([]);
  const [system, setSystem] = useState<AdminSystemStatus | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [nextRole, setNextRole] = useState<AdminUser["role"]>("creator");
  const [nextStatus, setNextStatus] = useState<AdminUser["status"]>("active");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<Date>();
  const [retryTarget, setRetryTarget] = useState<RetryTarget>();
  const [retryReason, setRetryReason] = useState("");
  const [retrying, setRetrying] = useState(false);

  const currentAllowed = allowedNavigation.some((item) => item.id === activeView);
  const effectiveView = currentAllowed ? activeView : allowedNavigation[0]?.id ?? "overview";

  useModalDrawer({
    active: mobileNavigation && mobileNavOpen,
    dialogRef: drawerRef,
    backgroundRef: mainRef,
    triggerRef: menuButtonRef,
    onClose: () => setMobileNavOpen(false),
  });

  useEffect(() => {
    if (!mobileNavigation) setMobileNavOpen(false);
  }, [mobileNavigation]);

  useEffect(() => {
    let cancelled = false;
    const hasCachedData =
      effectiveView === "overview"
        ? overview !== null
        : effectiveView === "processing"
          ? jobs.length > 0
          : effectiveView === "exports"
            ? exportJobs.length > 0
          : effectiveView === "users"
            ? users.length > 0
            : effectiveView === "billing"
              ? billing !== null
              : effectiveView === "audit"
                ? audit.length > 0
                : effectiveView === "system"
                  ? system !== null
                  : false;

    if (!hasCachedData) {
      setLoading(true);
    }
    setError(null);
    const operation =
      effectiveView === "overview"
        ? getAdminOverview().then((data) => setOverview(data))
        : effectiveView === "processing"
          ? getAdminProcessing().then(setJobs)
          : effectiveView === "exports"
            ? getAdminExports().then(setExportJobs)
          : effectiveView === "users"
            ? getAdminUsers().then(setUsers)
            : effectiveView === "billing"
              ? getAdminBilling().then(setBilling)
              : effectiveView === "audit"
                ? getAdminAudit().then(setAudit)
                : effectiveView === "system"
                  ? getAdminSystem().then(setSystem)
                  : Promise.resolve();

    void operation
      .then(() => {
        if (!cancelled) setLastSuccessfulAt(new Date());
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(
          caught instanceof ApiError
            ? caught.message
            : "تعذر الاتصال بخدمة الإدارة.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveView, reloadKey]);

  const retry = () => setReloadKey((value) => value + 1);

  const retryOperationalJob = async () => {
    if (!retryTarget || retryReason.trim().length < 10) return;
    setRetrying(true);
    try {
      if (retryTarget.kind === "processing") {
        const updated = await retryAdminProcessing(
          retryTarget.job.id,
          retryReason.trim(),
        );
        setJobs((current) =>
          current.map((job) => (job.id === updated.id ? updated : job)),
        );
      } else {
        const updated = await retryAdminExport(
          retryTarget.job.id,
          retryReason.trim(),
        );
        setExportJobs((current) =>
          current.map((job) => (job.id === updated.id ? updated : job)),
        );
      }
      setRetryTarget(undefined);
      setRetryReason("");
      onNotify("أُعيدت المهمة إلى الطابور وسُجل السبب في سجل التدقيق.");
    } catch (caught) {
      onNotify(
        caught instanceof ApiError
          ? caught.message
          : "تعذر طلب إعادة محاولة المهمة.",
      );
    } finally {
      setRetrying(false);
    }
  };

  const openUser = (user: AdminUser) => {
    setEditing(user);
    setNextRole(user.role);
    setNextStatus(user.status);
    setReason("");
  };

  const saveUser = async () => {
    if (!editing || reason.trim().length < 10) return;
    setSaving(true);
    try {
      const updated = await updateAdminUserAccess(editing.id, {
        role: nextRole,
        status: nextStatus,
        reason: reason.trim(),
      });
      setUsers((current) =>
        current.map((user) => (user.id === updated.id ? updated : user)),
      );
      setEditing(null);
      onNotify("تم تحديث الصلاحية وإبطال الجلسات المتأثرة وتسجيل الإجراء.");
    } catch (caught) {
      onNotify(
        caught instanceof ApiError
          ? caught.message
          : "تعذر حفظ تعديل المستخدم.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-shell" dir="rtl">
      {mobileNavigation && mobileNavOpen && <button type="button" className="nav-scrim" tabIndex={-1} aria-label="إغلاق قائمة الإدارة" aria-hidden="true" onClick={() => setMobileNavOpen(false)} />}
      {(!mobileNavigation || mobileNavOpen) && <aside
        ref={drawerRef}
        id={drawerId}
        className={`admin-sidebar ${mobileNavOpen ? "is-open" : ""}`}
        aria-label="التنقل الإداري"
        role={mobileNavigation ? "dialog" : undefined}
        aria-modal={mobileNavigation ? true : undefined}
        tabIndex={mobileNavigation ? -1 : undefined}
      >
        <header className="admin-brand"><span className="brand-mark"><Icon name="layers" size={19} /></span><div><strong>MotionPrep</strong><small>CONTROL ROOM</small></div><em>ADMIN</em><button type="button" className="icon-button admin-sidebar-close" aria-label="إغلاق قائمة الإدارة" onClick={() => setMobileNavOpen(false)} data-drawer-initial-focus><Icon name="close" size={18} /></button></header>
        <nav aria-label="التنقل الإداري">
          {allowedNavigation.map((item) => (
            <button type="button" className={effectiveView === item.id ? "is-active" : ""} key={item.id} onClick={() => { setActiveView(item.id); setQuery(""); setMobileNavOpen(false); }}>
              <Icon name={item.icon} size={18} /><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="admin-sidebar__scope"><Icon name="shieldCheck" size={16} /><span><strong>نطاق الصلاحية</strong><small>{roleLabels[role]} · مفروض من الخادم</small></span></div>
        <button type="button" className="admin-exit" onClick={onExit}><Icon name="arrow" size={16} /> العودة إلى الاستوديو</button>
      </aside>}

      <div ref={mainRef} className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar__leading"><button ref={menuButtonRef} type="button" className="icon-button admin-mobile-menu" aria-label="فتح قائمة الإدارة" aria-expanded={mobileNavOpen} aria-controls={drawerId} onClick={() => setMobileNavOpen(true)}><Icon name="menu" size={18} /></button><span className={`admin-connection ${error ? "is-error" : loading ? "is-checking" : "is-connected"}`}><i /> {error ? "تعذر الاتصال" : loading ? "جارٍ التحقق" : `متصل · ${lastSuccessfulAt?.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) ?? "الآن"}`}</span><b>مركز الإدارة</b></div>
          <div className="admin-topbar__actions"><button type="button" className="secondary-button" onClick={retry}><Icon name="refresh" size={15} /> تحديث</button><span className="admin-avatar">{roleLabels[role].slice(0, 1)}</span></div>
        </header>
        <main className="admin-content">
          {effectiveView === "overview" && <Overview data={overview} loading={loading} error={error} onRetry={retry} />}
          {effectiveView === "processing" && <Processing jobs={jobs} query={query} onQuery={setQuery} loading={loading} error={error} onRetry={retry} canRetry={role === "admin"} onRetryJob={(job) => { setRetryTarget({ kind: "processing", job }); setRetryReason(""); }} />}
          {effectiveView === "exports" && <Exports jobs={exportJobs} query={query} onQuery={setQuery} loading={loading} error={error} onRetry={retry} canRetry={role === "admin"} onRetryJob={(job) => { setRetryTarget({ kind: "export", job }); setRetryReason(""); }} />}
          {effectiveView === "users" && <Users users={users} query={query} onQuery={setQuery} canEdit={role === "admin"} onOpen={openUser} loading={loading} error={error} onRetry={retry} />}
          {effectiveView === "billing" && <Billing data={billing} loading={loading} error={error} onRetry={retry} />}
          {effectiveView === "audit" && <Audit rows={audit} query={query} onQuery={setQuery} onNotify={onNotify} loading={loading} error={error} onRetry={retry} />}
          {effectiveView === "system" && <System data={system} loading={loading} error={error} onRetry={retry} />}
        </main>
      </div>

      {editing && (
        <Dialog
          title={`إدارة وصول ${editing.name}`}
          description="ينفذ الخادم التغيير، ويبطل الجلسات عند تغيير الدور أو إيقاف الحساب، ويسجل السبب."
          onClose={() => !saving && setEditing(null)}
          className="confirm-dialog"
          footer={<><button type="button" className="secondary-button" disabled={saving} onClick={() => setEditing(null)}>إلغاء</button><button type="button" className="primary-button" disabled={saving || reason.trim().length < 10} onClick={() => void saveUser()}>{saving ? "جارٍ الحفظ…" : "حفظ وتسجيل الإجراء"}</button></>}
        >
          <label className="dialog-field">الدور<select value={nextRole} onChange={(event) => setNextRole(event.target.value as AdminUser["role"])}><option value="creator">صانع محتوى</option><option value="support">دعم</option><option value="finance">مالية</option><option value="admin">مدير</option></select></label>
          <label className="dialog-field">حالة الحساب<select value={nextStatus} onChange={(event) => setNextStatus(event.target.value as AdminUser["status"])}><option value="active">نشط</option><option value="pending_verification">بانتظار التحقق</option><option value="suspended">موقوف</option></select></label>
          <label className="dialog-field">سبب الإجراء<textarea rows={4} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="اكتب سببًا واضحًا من 10 أحرف على الأقل" /></label>
        </Dialog>
      )}
      {retryTarget && (
        <Dialog
          role="alertdialog"
          title={`إعادة مهمة ${retryTarget.kind === "processing" ? "المعالجة" : "التصدير"} إلى الطابور؟`}
          description="ينفذ الخادم الإجراء فقط إذا ظلت المهمة فاشلة ومصدرها هو الإصدار الحالي الجاهز."
          onClose={() => !retrying && setRetryTarget(undefined)}
          className="confirm-dialog"
          footer={<><button type="button" className="secondary-button" disabled={retrying} onClick={() => setRetryTarget(undefined)}>إلغاء</button><button type="button" className="danger-button" disabled={retrying || retryReason.trim().length < 10} onClick={() => void retryOperationalJob()}>{retrying ? "جارٍ الإعادة…" : "إعادة إلى الطابور"}</button></>}
        >
          <label className="dialog-field">سبب إعادة المحاولة<textarea rows={4} value={retryReason} onChange={(event) => setRetryReason(event.target.value)} placeholder="اشرح سبب التدخل اليدوي في 10 أحرف على الأقل" /></label>
        </Dialog>
      )}
    </div>
  );
}

function Overview({ data, loading, error, onRetry }: { data: AdminOverviewData | null; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading || error || !data) return <DataFeedback loading={loading} error={error} onRetry={onRetry} />;
  const failures = data.uploads.failed + data.exports.failed + data.processing.failed;
  return (
    <section className="admin-view page-enter">
      <header className="admin-page-heading"><div><span className="eyebrow">بيانات تشغيلية فعلية</span><h1>نظرة عامة</h1><p>ملخص مباشر من قاعدة البيانات، بلا أرقام أو إيرادات تجريبية.</p></div><span className="admin-updated"><i /> محدث الآن</span></header>
      <div className="admin-overview-grid">
        <article className="admin-stat"><span><Icon name="users" size={19} /></span><div><small>المستخدمون</small><strong>{data.users.total}</strong><em>{data.users.active} نشط</em></div></article>
        <article className="admin-stat"><span><Icon name="activity" size={19} /></span><div><small>المعالجة النشطة</small><strong>{data.processing.active}</strong><em>{data.processing.total} إجمالي</em></div></article>
        <article className="admin-stat"><span><Icon name="download" size={19} /></span><div><small>التصديرات</small><strong>{data.exports.total}</strong><em>{data.exports.queued} في الانتظار</em></div></article>
        <article className="admin-stat"><span><Icon name="creditCard" size={19} /></span><div><small>الاشتراكات النشطة</small><strong>{data.billing.activeSubscriptions}</strong><em>{data.billing.pendingCheckouts} دفع معلّق</em></div></article>
      </div>
      <section className="operational-rail">
        <header className="operational-rail__head"><div><strong>سلامة التشغيل</strong><small>مستخلص من الرفع والمعالجة والتصدير</small></div><Status tone={failures > 0 ? "danger" : "ready"}>{failures > 0 ? `${failures} حالات فشل` : "لا توجد حالات فشل"}</Status></header>
      </section>
      <div className="admin-overview-details">
        <section className="admin-insight-panel" aria-labelledby="pipeline-summary-title">
          <header><div><span className="eyebrow">الحمل الحالي</span><h2 id="pipeline-summary-title">حركة خط الإنتاج</h2></div><Status tone={failures > 0 ? "danger" : "ready"}>{failures > 0 ? `${failures} فشل` : "مستقر"}</Status></header>
          <dl className="admin-pipeline-metrics">
            <div><dt>الرفع</dt><dd><strong>{data.uploads.active}</strong><span>نشط من {data.uploads.total}</span></dd></div>
            <div><dt>المعالجة</dt><dd><strong>{data.processing.active}</strong><span>نشط من {data.processing.total}</span></dd></div>
            <div><dt>التصدير</dt><dd><strong>{data.exports.queued}</strong><span>منتظر من {data.exports.total}</span></dd></div>
          </dl>
        </section>
        <section className="admin-insight-panel" aria-labelledby="recent-audit-title">
          <header><div><span className="eyebrow">قابلية التتبع</span><h2 id="recent-audit-title">أحدث النشاط الإداري</h2></div><span className="bounded-note">{data.audit.length} إجراء</span></header>
          {data.audit.length > 0 ? <div className="admin-recent-audit">{data.audit.slice(0, 4).map((event) => <article key={event.id}><span><strong>{event.action}</strong><small>{formatDate(event.createdAt)}</small></span><Status tone={outcomeTone(event.outcome)}>{event.outcome}</Status></article>)}</div> : <div className="admin-empty admin-empty--compact"><Icon name="history" size={24} /><strong>لا توجد إجراءات إدارية مسجلة</strong><span>سيظهر هنا أحدث نشاط موثق مع بدء التشغيل.</span></div>}
        </section>
      </div>
    </section>
  );
}

function Users({ users, query, onQuery, canEdit, onOpen, loading, error, onRetry }: { users: AdminUser[]; query: string; onQuery: (value: string) => void; canEdit: boolean; onOpen: (user: AdminUser) => void; loading: boolean; error: string | null; onRetry: () => void }) {
  const debouncedQuery = useDebounce(query, 250);
  const visible = users.filter((user) => `${user.name} ${user.email} ${user.role} ${user.status}`.toLowerCase().includes(debouncedQuery.toLowerCase()));
  return (
    <section className="admin-view page-enter">
      <header className="admin-page-heading"><div><span className="eyebrow">الحسابات والصلاحيات</span><h1>المستخدمون</h1><p>الدعم يقرأ البيانات، والمدير فقط يستطيع تعديل الوصول بسبب مسجل.</p></div><span className="bounded-note">{users.length} حساب</span></header>
      <Search value={query} onChange={onQuery} placeholder="الاسم أو البريد أو الدور…" />
      <DataFeedback loading={loading} error={error} empty={!loading && !error && visible.length === 0} onRetry={onRetry} />
      {!loading && !error && visible.length > 0 && (
        <div className="admin-data-table users-table" role="table" aria-label="المستخدمون">
          <div className="admin-data-head" role="row">
            <span role="columnheader">المستخدم</span>
            <span role="columnheader">الدور</span>
            <span role="columnheader">MFA</span>
            <span role="columnheader">آخر دخول</span>
            <span role="columnheader">الحالة</span>
            <span role="columnheader" aria-label="إدارة الوصول" />
          </div>
          {visible.map((user) => (
            <button type="button" className="admin-data-row" role="row" key={user.id} disabled={!canEdit} onClick={() => onOpen(user)} title={canEdit ? `إدارة وصول ${user.name} (${user.email})` : `وصول للقراءة فقط: ${user.name} (${user.email})`}>
              <span className="user-cell" role="cell"><i>{user.name.slice(0, 1)}</i><span><strong>{user.name}</strong><small title={user.email}>{user.email}</small></span></span>
              <span role="cell" data-label="الدور">{roleLabels[user.role]}</span>
              <span role="cell" data-label="المصادقة">{user.mfaEnabled ? "مفعّلة" : "غير مفعّلة"}</span>
              <span role="cell" data-label="آخر دخول">{formatDate(user.lastLoginAt)}</span>
              <span role="cell" data-label="الحالة"><Status tone={user.status === "active" ? "ready" : user.status === "suspended" ? "danger" : "review"}>{accountStatusLabels[user.status]}</Status></span>
              <span role="cell"><Icon name={canEdit ? "chevron" : "lock"} size={15} /></span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Billing({ data, loading, error, onRetry }: { data: AdminBillingData | null; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading || error || !data) return <DataFeedback loading={loading} error={error} onRetry={onRetry} />;
  return (
    <section className="admin-view page-enter">
      <header className="admin-page-heading"><div><span className="eyebrow">سجل فوترة للقراءة</span><h1>الفوترة</h1><p>الحالة والمبلغ كما سجلهما الخادم؛ لا توجد أزرار استرداد أو إيرادات محسوبة دون عقد مزود مكتمل.</p></div></header>
      <div className="admin-overview-grid"><article className="admin-stat"><span><Icon name="creditCard" size={19} /></span><div><small>الاشتراكات</small><strong>{data.subscriptions.length}</strong></div></article><article className="admin-stat"><span><Icon name="history" size={19} /></span><div><small>جلسات الدفع</small><strong>{data.checkouts.length}</strong></div></article></div>
      <DataFeedback loading={false} error={null} empty={data.checkouts.length === 0} onRetry={onRetry} />
      {data.checkouts.length > 0 && <section className="billing-admin-list"><header><div><strong>أحدث جلسات الدفع</strong><small>رابط الدفع السري لا يُعرض في لوحة الإدارة</small></div></header>{data.checkouts.map((checkout) => <div className="billing-admin-row" key={checkout.id}><bdi>{checkout.id.slice(0, 12)}</bdi><strong>{checkout.provider}</strong><span>{checkout.planId}</span><Status tone={checkout.status === "paid" ? "ready" : checkout.status === "failed" ? "danger" : "review"}>{checkout.status}</Status><small>{(checkout.amountMinor / 100).toFixed(2)} {checkout.currency}</small><span>{formatDate(checkout.createdAt)}</span></div>)}</section>}
    </section>
  );
}

function Audit({ rows, query, onQuery, onNotify, loading, error, onRetry }: { rows: AdminAuditEvent[]; query: string; onQuery: (value: string) => void; onNotify: (message: string) => void; loading: boolean; error: string | null; onRetry: () => void }) {
  const debouncedQuery = useDebounce(query, 250);
  const visible = rows.filter((row) => `${row.actorUserId} ${row.action} ${row.targetId} ${row.requestId}`.toLowerCase().includes(debouncedQuery.toLowerCase()));
  const download = () => {
    const cells = [["created_at", "actor_user_id", "action", "target_type", "target_id", "outcome", "reason", "request_id"], ...visible.map((row) => [row.createdAt, row.actorUserId, row.action, row.targetType, row.targetId, row.outcome, row.reason ?? "", row.requestId])];
    const csv = cells.map((line) => line.map((cell) => `"${cell.replace(/"/g, "\"\"")}"`).join(",")).join("\n");
    downloadBlob([`\uFEFF${csv}`], {
      filename: `motionprep-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      type: "text/csv;charset=utf-8",
    });
    onNotify("تم تنزيل السجلات المعروضة بصيغة CSV.");
  };
  return (
    <section className="admin-view page-enter">
      <header className="admin-page-heading"><div><span className="eyebrow">سجل غير قابل للتعديل</span><h1>سجل التدقيق</h1><p>كل صف وارد من مخزن التدقيق ويرتبط بمعرّف الطلب.</p></div><button type="button" className="secondary-button" disabled={visible.length === 0} onClick={download}><Icon name="download" size={15} /> تنزيل CSV</button></header>
      <Search value={query} onChange={onQuery} placeholder="الفاعل أو الإجراء أو الهدف أو Request ID…" />
      <DataFeedback loading={loading} error={error} empty={!loading && !error && visible.length === 0} onRetry={onRetry} />
      {!loading && !error && visible.length > 0 && <AuditTable rows={visible} />}
    </section>
  );
}

function AuditTable({ rows }: { rows: AdminAuditEvent[] }) {
  if (rows.length === 0) return <div className="admin-empty"><Icon name="history" size={24} /><strong>لا توجد إجراءات إدارية مسجلة</strong></div>;
  return (
    <div className="admin-data-table audit-table" role="table" aria-label="سجل التدقيق">
      <div className="admin-data-head" role="row">
        <span role="columnheader">الوقت</span>
        <span role="columnheader">الفاعل</span>
        <span role="columnheader">الإجراء</span>
        <span role="columnheader">الهدف</span>
        <span role="columnheader">النتيجة</span>
        <span role="columnheader">Request ID</span>
      </div>
      {rows.map((row) => (
        <div className="admin-data-row" role="row" key={row.id}>
          <span role="cell">{formatDate(row.createdAt)}</span>
          <span role="cell"><bdi>{row.actorUserId.slice(0, 12)}</bdi></span>
          <span role="cell"><code>{row.action}</code></span>
          <span role="cell"><bdi>{row.targetId.slice(0, 12)}</bdi></span>
          <span role="cell"><Status tone={outcomeTone(row.outcome)}>{row.outcome}</Status></span>
          <span className="trace-cell" role="cell"><bdi>{row.requestId.slice(0, 16)}</bdi></span>
        </div>
      ))}
    </div>
  );
}

export function System({
  data,
  loading,
  error,
  onRetry,
}: {
  data: AdminSystemStatus | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const healthyWorkers =
    data?.workers.filter((worker) => !worker.stale).length ?? 0;
  const queueFailures =
    data?.queues.reduce((sum, queue) => sum + queue.failed, 0) ?? 0;
  return (
    <section className="admin-view page-enter">
      <header className="admin-page-heading"><div><span className="eyebrow">قياس فعلي من الخادم</span><h1>التشغيل</h1><p>صحة العمال والطوابير من آخر heartbeat وحالة الوظائف الدائمة.</p></div></header>
      <DataFeedback loading={loading} error={error} empty={!loading && !error && !data} onRetry={onRetry} />
      {!loading && !error && data && (
      <div className="system-settings-list">
        <article><span><Icon name="activity" size={19} /></span><div><strong>حالة المنظومة</strong><small>آخر فحص {formatDate(data.checkedAt)}</small></div><Status tone={data.status === "ready" ? "ready" : "danger"}>{data.status === "ready" ? "جاهزة" : "متدهورة"}</Status><span /></article>
        <article><span><Icon name="settings" size={19} /></span><div><strong>العمال النشطون</strong><small>{healthyWorkers} من {data.workers.length} heartbeat حديث</small></div><Status tone={healthyWorkers >= 3 ? "ready" : "review"}>{healthyWorkers}</Status><span /></article>
        <article><span><Icon name="warning" size={19} /></span><div><strong>وظائف فاشلة</strong><small>إجمالي الحالات الفاشلة في الطوابير المرصودة</small></div><Status tone={queueFailures > 0 ? "danger" : "ready"}>{queueFailures}</Status><span /></article>
        <article><span><Icon name="history" size={19} /></span><div><strong>تنظيف الاحتفاظ</strong><small>{data.maintenance?.lastSucceededAt ? `آخر نجاح ${formatDate(data.maintenance.lastSucceededAt)}` : "لم يُسجل تشغيل ناجح بعد"}{data.maintenance?.lastError ? ` · ${data.maintenance.lastError}` : ""}</small></div><Status tone={!data.maintenance || data.maintenance.stale ? "danger" : "ready"}>{!data.maintenance ? "مفقود" : data.maintenance.stale ? "متأخر" : "منتظم"}</Status><span /></article>
        {data.queues.map((queue) => (
          <article key={queue.queue}><span><Icon name="database" size={19} /></span><div><strong>{queue.queue}</strong><small>انتظار {queue.queued} · نشط {queue.active} · أقدم انتظار {Math.round(queue.oldestQueuedSeconds)}ث</small></div><Status tone={queue.oldestQueuedSeconds > 120 || queue.failed > 0 ? "review" : "ready"}>{queue.failed > 0 ? `${queue.failed} فشل` : "مستقرة"}</Status><span /></article>
        ))}
      </div>
      )}
    </section>
  );
}
