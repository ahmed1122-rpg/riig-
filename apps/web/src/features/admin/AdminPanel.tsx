import { useEffect, useState } from "react";
import {
  ApiError,
  getAdminAudit,
  getAdminBilling,
  getAdminOverview,
  getAdminProcessing,
  getAdminSystem,
  getAdminUsers,
  updateAdminUserAccess,
  type AdminAuditEvent,
  type AdminBillingData,
  type AdminOverview as AdminOverviewData,
  type AdminProcessingJob,
  type AdminSystemStatus,
  type AdminUser,
} from "../../lib/api";
import { Dialog } from "../../shared/Dialog";
import { formatDateTime } from "../../shared/formatters";
import { Icon, type IconName } from "../../shared/Icon";
import type { AdminView, UserRole } from "../../types";

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

const roleLabels: Record<UserRole, string> = {
  creator: "صانع محتوى",
  support: "دعم",
  finance: "مالية",
  admin: "مدير",
};

const navigation: AdminNavItem[] = [
  { id: "overview", label: "نظرة عامة", icon: "gauge", roles: ["support", "finance", "admin"] },
  { id: "processing", label: "المعالجة", icon: "activity", roles: ["support", "admin"] },
  { id: "users", label: "المستخدمون", icon: "users", roles: ["support", "admin"] },
  { id: "billing", label: "الفوترة", icon: "creditCard", roles: ["finance", "admin"] },
  { id: "audit", label: "سجل التدقيق", icon: "history", roles: ["support", "finance", "admin"] },
  { id: "system", label: "التشغيل", icon: "settings", roles: ["admin"] },
];

type Tone = "ready" | "review" | "danger" | "processing" | undefined;

function Status({ children, tone }: { children: React.ReactNode; tone?: Tone }) {
  return (
    <span className={`status ${tone ? `status--${tone}` : ""}`}>
      {children}
    </span>
  );
}

function DataFeedback({
  loading,
  error,
  empty,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  empty?: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return <div className="admin-empty" role="status"><Icon name="activity" size={24} /><strong>جارٍ تحميل البيانات الفعلية…</strong></div>;
  }
  if (error) {
    return <div className="admin-empty" role="alert"><Icon name="warning" size={24} /><strong>تعذر تحميل البيانات</strong><span>{error}</span><button className="secondary-button" type="button" onClick={onRetry}>إعادة المحاولة</button></div>;
  }
  if (empty) {
    return <div className="admin-empty"><Icon name="folder" size={24} /><strong>لا توجد بيانات حتى الآن</strong><span>ستظهر السجلات هنا عند بدء الاستخدام.</span></div>;
  }
  return null;
}

function formatDate(value: string | null): string {
  return formatDateTime(value, "لم يسجّل دخوله");
}

function outcomeTone(outcome: AdminAuditEvent["outcome"]): Tone {
  return outcome === "success" ? "ready" : outcome === "denied" ? "review" : "danger";
}

export default function AdminPanel({ role, onExit, onNotify }: AdminPanelProps) {
  const allowedNavigation = navigation.filter((item) => item.roles.includes(role));
  const [activeView, setActiveView] = useState<AdminView>(allowedNavigation[0]?.id ?? "overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [jobs, setJobs] = useState<AdminProcessingJob[]>([]);
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

  const currentAllowed = allowedNavigation.some((item) => item.id === activeView);
  const effectiveView = currentAllowed ? activeView : allowedNavigation[0]?.id ?? "overview";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const operation =
      effectiveView === "overview"
        ? getAdminOverview().then((data) => setOverview(data))
        : effectiveView === "processing"
          ? getAdminProcessing().then(setJobs)
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
      {mobileNavOpen && <button type="button" className="nav-scrim" aria-label="إغلاق قائمة الإدارة" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`admin-sidebar ${mobileNavOpen ? "is-open" : ""}`}>
        <header className="admin-brand"><span className="brand-mark"><Icon name="layers" size={19} /></span><div><strong>MotionPrep</strong><small>CONTROL ROOM</small></div><em>ADMIN</em></header>
        <nav aria-label="التنقل الإداري">
          {allowedNavigation.map((item) => (
            <button type="button" className={effectiveView === item.id ? "is-active" : ""} key={item.id} onClick={() => { setActiveView(item.id); setQuery(""); setMobileNavOpen(false); }}>
              <Icon name={item.icon} size={18} /><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="admin-sidebar__scope"><Icon name="shieldCheck" size={16} /><span><strong>نطاق الصلاحية</strong><small>{roleLabels[role]} · مفروض من الخادم</small></span></div>
        <button type="button" className="admin-exit" onClick={onExit}><Icon name="arrow" size={16} /> العودة إلى الاستوديو</button>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar__leading"><button type="button" className="icon-button admin-mobile-menu" aria-label="فتح قائمة الإدارة" onClick={() => setMobileNavOpen(true)}><Icon name="menu" size={18} /></button><span><i /> متصل بالخادم</span><b>مركز الإدارة</b></div>
          <div className="admin-topbar__actions"><button type="button" className="secondary-button" onClick={retry}><Icon name="refresh" size={15} /> تحديث</button><span className="admin-avatar">{roleLabels[role].slice(0, 1)}</span></div>
        </header>
        <main className="admin-content">
          {effectiveView === "overview" && <Overview data={overview} loading={loading} error={error} onRetry={retry} />}
          {effectiveView === "processing" && <Processing jobs={jobs} query={query} onQuery={setQuery} loading={loading} error={error} onRetry={retry} />}
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
      <AuditTable rows={data.audit} />
    </section>
  );
}

function Processing({ jobs, query, onQuery, loading, error, onRetry }: { jobs: AdminProcessingJob[]; query: string; onQuery: (value: string) => void; loading: boolean; error: string | null; onRetry: () => void }) {
  const visible = jobs.filter((job) => `${job.id} ${job.projectId} ${job.status} ${job.errorCode ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <section className="admin-view page-enter">
      <header className="admin-page-heading"><div><span className="eyebrow">طابور المعالجة</span><h1>المعالجة</h1><p>قراءة مباشرة لحالة المهام؛ إعادة المحاولة اليدوية مؤجلة حتى يتوفر عقد آمن لها.</p></div></header>
      <Search value={query} onChange={onQuery} placeholder="رقم المهمة أو المشروع أو رمز الخطأ…" />
      <DataFeedback loading={loading} error={error} empty={!loading && !error && visible.length === 0} onRetry={onRetry} />
      {!loading && !error && visible.length > 0 && (
        <div className="admin-data-table processing-table" role="table" aria-label="مهام المعالجة">
          <div className="admin-data-head" role="row">
            <span role="columnheader">المهمة</span>
            <span role="columnheader">النوع</span>
            <span role="columnheader">الحالة</span>
            <span role="columnheader">التقدم</span>
            <span role="columnheader">آخر تحديث</span>
            <span role="columnheader" aria-label="التنبيه" />
          </div>
          {visible.map((job) => (
            <div className="admin-data-row" role="row" key={job.id}>
              <span role="cell"><strong><bdi>{job.id.slice(0, 12)}</bdi></strong><small><bdi>{job.projectId.slice(0, 12)}</bdi></small></span>
              <span role="cell">{job.projectKind === "image" ? "صورة" : "PDF"}</span>
              <span role="cell"><Status tone={job.status === "ready" ? "ready" : job.status === "failed" ? "danger" : "processing"}>{job.status}</Status></span>
              <span role="cell"><bdi>{job.progress}%</bdi></span>
              <span role="cell">{formatDate(job.updatedAt)}</span>
              <span role="cell">{job.errorCode ? <abbr title={job.errorCode}>!</abbr> : null}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Users({ users, query, onQuery, canEdit, onOpen, loading, error, onRetry }: { users: AdminUser[]; query: string; onQuery: (value: string) => void; canEdit: boolean; onOpen: (user: AdminUser) => void; loading: boolean; error: string | null; onRetry: () => void }) {
  const visible = users.filter((user) => `${user.name} ${user.email} ${user.role} ${user.status}`.toLowerCase().includes(query.toLowerCase()));
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
            <button type="button" className="admin-data-row" role="row" key={user.id} disabled={!canEdit} onClick={() => onOpen(user)} title={canEdit ? "إدارة الوصول" : "وصول الدعم للقراءة فقط"}>
              <span className="user-cell" role="cell"><i>{user.name.slice(0, 1)}</i><span><strong>{user.name}</strong><small>{user.email}</small></span></span>
              <span role="cell">{roleLabels[user.role]}</span>
              <span role="cell">{user.mfaEnabled ? "مفعّل" : "غير مفعّل"}</span>
              <span role="cell">{formatDate(user.lastLoginAt)}</span>
              <span role="cell"><Status tone={user.status === "active" ? "ready" : user.status === "suspended" ? "danger" : "review"}>{user.status}</Status></span>
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
  const visible = rows.filter((row) => `${row.actorUserId} ${row.action} ${row.targetId} ${row.requestId}`.toLowerCase().includes(query.toLowerCase()));
  const download = () => {
    const cells = [["created_at", "actor_user_id", "action", "target_type", "target_id", "outcome", "reason", "request_id"], ...visible.map((row) => [row.createdAt, row.actorUserId, row.action, row.targetType, row.targetId, row.outcome, row.reason ?? "", row.requestId])];
    const csv = cells.map((line) => line.map((cell) => `"${cell.replace(/"/g, "\"\"")}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `motionprep-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
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

function System({
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
        {data.queues.map((queue) => (
          <article key={queue.queue}><span><Icon name="database" size={19} /></span><div><strong>{queue.queue}</strong><small>انتظار {queue.queued} · نشط {queue.active} · أقدم انتظار {Math.round(queue.oldestQueuedSeconds)}ث</small></div><Status tone={queue.oldestQueuedSeconds > 120 || queue.failed > 0 ? "review" : "ready"}>{queue.failed > 0 ? `${queue.failed} فشل` : "مستقرة"}</Status><span /></article>
        ))}
      </div>
      )}
    </section>
  );
}

function Search({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="admin-table-toolbar"><label className="admin-search"><Icon name="search" size={16} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label="بحث" /></label></div>;
}
