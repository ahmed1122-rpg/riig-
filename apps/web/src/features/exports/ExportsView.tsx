import { useEffect, useState } from "react";
import {
  cancelExport,
  downloadExport,
  listExports,
  type ExportSummary,
} from "../../lib/api";
import { DataState } from "../../shared/DataState";
import { formatBytes, formatDateTime } from "../../shared/formatters";
import { Icon } from "../../shared/Icon";
import type { DemoState } from "../../types";
import { getExportFormatPresentation } from "./exportPresentation";

interface ExportsViewProps {
  authenticated: boolean;
  onRequireAuth: () => void;
  onCreateProject: () => void;
  onViewProjects: () => void;
  onNotify: (message: string) => void;
}

const statusLabels: Record<ExportSummary["status"], string> = {
  preflight: "فحص أولي",
  queued: "في الانتظار",
  generating: "قيد الإنشاء",
  verifying: "قيد التحقق",
  ready: "جاهز",
  failed: "فشل",
  cancelled: "ملغى",
};

export function ExportsView({
  authenticated,
  onRequireAuth,
  onCreateProject,
  onViewProjects,
  onNotify,
}: ExportsViewProps) {
  const [items, setItems] = useState<ExportSummary[]>([]);
  const [state, setState] = useState<DemoState>(
    authenticated ? "loading" : "empty",
  );
  const [cancellingId, setCancellingId] = useState<string>();
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    if (!authenticated) {
      setState("empty");
      setItems([]);
      return;
    }
    let active = true;
    let refreshTimer: number | undefined;
    setState("loading");
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void listExports()
        .then((exports) => {
          if (!active) return;
          setItems(exports);
          setState(exports.length ? "ready" : "empty");
          if (
            exports.some((item) =>
              ["preflight", "queued", "generating", "verifying"].includes(
                item.status,
              ),
            )
          ) {
            refreshTimer = window.setTimeout(refresh, 1_500);
          }
        })
        .catch(() => {
          if (!active) return;
          setState("error");
        });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
        refreshTimer = undefined;
        return;
      }
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = undefined;
      refresh();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    refresh();
    return () => {
      active = false;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [authenticated, reloadVersion]);

  if (!authenticated) {
    return (
      <div className="projects-view page-enter">
        <section className="page-title-row">
          <div>
            <span className="eyebrow">ملفاتك الناتجة</span>
            <h1>التصديرات</h1>
            <p>سجّل الدخول للوصول إلى الملفات وروابط التنزيل.</p>
          </div>
          <button className="primary-button" type="button" onClick={onRequireAuth}>
            <Icon name="login" size={17} /> تسجيل الدخول
          </button>
        </section>
        <DataState state="empty" />
      </div>
    );
  }

  const cancel = async (exportId: string) => {
    setCancellingId(exportId);
    try {
      const cancelled = await cancelExport(exportId);
      setItems((current) =>
        current.map((item) => (item.id === exportId ? cancelled : item)),
      );
    } catch (error) {
      onNotify(
        error instanceof Error
          ? error.message
          : "تعذر إلغاء التصدير. أعد المحاولة.",
      );
    } finally {
      setCancellingId(undefined);
    }
  };

  return (
    <div className="projects-view page-enter">
      <section className="page-title-row">
        <div>
          <span className="eyebrow">ملفاتك الناتجة</span>
          <h1>التصديرات</h1>
          <p>الحالة والبصمة والحجم من سجل الخادم الفعلي.</p>
        </div>
      </section>

      {state === "ready" ? (
        <section className="project-list" aria-label="ملفات التصدير">
          {items.map((item) => {
            const downloadable =
              item.status === "ready" &&
              item.artifact &&
              new Date(item.artifact.expiresAt).getTime() > Date.now();
            return (
              <article className="project-row" key={item.id}>
                <span className="project-preview project-preview--image">
                  <Icon name="packageCheck" size={25} />
                </span>
                <div className="project-info">
                  <strong dir="ltr">
                    {item.artifact?.filename ?? `${item.format}.${item.id.slice(0, 8)}`}
                  </strong>
                  <small>
                    {getExportFormatPresentation(item.format).label}
                    {item.artifact
                      ? ` · ${formatBytes(item.artifact.sizeBytes)}`
                      : item.attempt > 0
                        ? ` · محاولة ${item.attempt}/${item.maxAttempts}`
                        : ""}
                    {item.errorCode ? ` · ${item.errorCode}` : ""}
                  </small>
                </div>
                <div className="project-progress">
                  <span><i style={{ width: `${item.progress}%` }} /></span>
                  <small>{item.progress}%</small>
                </div>
                <span className={`status status--${item.status}`}>
                  {statusLabels[item.status]}
                </span>
                <span className="project-updated">
                  {formatDateTime(item.updatedAt)}
                </span>
                <div className="export-row-actions">
                  {["preflight", "queued", "generating"].includes(item.status) && (
                    <button
                      className="icon-button"
                      type="button"
                      disabled={cancellingId === item.id}
                      onClick={() => void cancel(item.id)}
                      aria-label="إلغاء التصدير"
                      title="إلغاء التصدير"
                    >
                      <Icon name="close" size={17} />
                    </button>
                  )}
                  <button
                    className="icon-button"
                    type="button"
                    disabled={!downloadable}
                    onClick={() => downloadExport(item.id)}
                    aria-label={downloadable ? "تنزيل الملف" : "الملف غير جاهز"}
                  >
                    <Icon name="download" size={18} />
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      ) : state === "empty" ? (
        <section className="data-state">
          <span className="state-icon"><Icon name="packageCheck" size={23} /></span>
          <div>
            <strong>لا توجد تصديرات بعد</strong>
            <p>ابدأ مشروعًا جديدًا، أو افتح مشروعًا قائمًا لمراجعة طبقاته وتصديره.</p>
            <div className="data-state__actions">
              <button className="primary-button" type="button" onClick={onCreateProject}>
                <Icon name="plus" size={17} /> مشروع جديد
              </button>
              <button className="secondary-button" type="button" onClick={onViewProjects}>
                <Icon name="folder" size={17} /> عرض المشاريع
              </button>
            </div>
          </div>
        </section>
      ) : (
        <DataState
          state={state}
          onRetry={() => setReloadVersion((version) => version + 1)}
        />
      )}
    </div>
  );
}
