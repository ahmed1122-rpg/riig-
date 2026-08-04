import type { ReactNode } from "react";
import type { AdminAuditEvent } from "../../lib/api";
import { Icon } from "../../shared/Icon";

export type AdminTone =
  | "ready"
  | "review"
  | "danger"
  | "processing"
  | undefined;

export function Status({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: AdminTone;
}) {
  return (
    <span className={`status ${tone ? `status--${tone}` : ""}`}>
      {children}
    </span>
  );
}

export function DataFeedback({
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

export function Search({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return <div className="admin-table-toolbar"><label className="admin-search"><Icon name="search" size={16} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label="بحث" /></label></div>;
}

export function outcomeTone(outcome: AdminAuditEvent["outcome"]): AdminTone {
  return outcome === "success"
    ? "ready"
    : outcome === "denied"
      ? "review"
      : "danger";
}
