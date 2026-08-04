import { Icon } from "./Icon";
import type { DemoState } from "../types";

interface DataStateProps {
  state: Exclude<DemoState, "ready">;
  title?: string;
  description?: string;
  compact?: boolean;
  onRetry?: () => void;
}

export function DataState({
  state,
  title,
  description,
  compact = false,
  onRetry,
}: DataStateProps) {
  if (state === "loading") {
    return (
      <section className={`data-state ${compact ? "is-compact" : ""}`} aria-busy="true">
        <span className="state-spinner" />
        <div>
          <strong>{title ?? "جارٍ تجهيز مساحة العمل"}</strong>
          <p>{description ?? "نقرأ الملف ونرتب الخطوات المناسبة له."}</p>
        </div>
        <div className="skeleton-lines" aria-hidden="true"><span /><span /><span /></div>
      </section>
    );
  }

  if (state === "empty") {
    return (
      <section className={`data-state ${compact ? "is-compact" : ""}`}>
        <span className="state-icon"><Icon name="folder" size={23} /></span>
        <div>
          <strong>{title ?? "لا توجد مشاريع بعد"}</strong>
          <p>{description ?? "ابدأ بملف واحد، وسنرشدك حتى النسخة الجاهزة لـ Adobe."}</p>
        </div>
      </section>
    );
  }

  return (
    <section className={`data-state is-error ${compact ? "is-compact" : ""}`} role="alert">
      <span className="state-icon"><Icon name="warning" size={23} /></span>
      <div>
        <strong>{title ?? "تعذّر عرض البيانات"}</strong>
        <p>{description ?? "ملفك آمن ولم يتغير. أعد المحاولة."}</p>
      </div>
      {onRetry && (
        <button className="secondary-button" type="button" onClick={onRetry}>
          <Icon name="refresh" size={16} /> إعادة المحاولة
        </button>
      )}
    </section>
  );
}
