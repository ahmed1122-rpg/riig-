import { Fragment, useEffect, useMemo, useState } from "react";
import { useDebounce } from "../../shared/hooks/useDebounce";
import { useResourcePolling } from "../../shared/hooks/useResourcePolling";
import { DataState } from "../../shared/DataState";
import { formatBytes, formatDateTime } from "../../shared/formatters";
import { Icon } from "../../shared/Icon";
import { useConfirmation } from "../../shared/useConfirmation";
import type { DemoState, ProjectMode } from "../../types";
import {
  ApiError,
  deleteEmptyProject,
  listProjects,
  listSourceVersions,
  type ProjectSummary,
  type SourceVersionSummary,
} from "../../lib/api";

interface ProjectsViewProps {
  demoState: DemoState;
  onOpenWorkspace: (
    mode: ProjectMode,
    project?: Pick<
      ProjectSummary,
      | "id"
      | "name"
      | "currentSourceVersionId"
      | "currentSourceVersionNumber"
    >,
  ) => void;
  authenticated: boolean;
  onRequireAuth: () => void;
}

const statusLabel: Record<ProjectSummary["status"], string> = {
  draft: "مسودة",
  validating: "جارٍ التحقق",
  uploading: "جارٍ الرفع",
  queued: "في قائمة الانتظار",
  processing: "قيد التجهيز",
  needs_review: "يحتاج مراجعة",
  approved: "معتمد",
  exporting: "قيد التصدير",
  completed: "مكتمل",
  failed: "فشل",
  cancelled: "ملغى",
};
const liveProjectStatuses = new Set<ProjectSummary["status"]>([
  "validating",
  "uploading",
  "queued",
  "processing",
  "exporting",
]);

export function ProjectsView({
  demoState,
  authenticated,
  onRequireAuth,
  onOpenWorkspace,
}: ProjectsViewProps) {
  const [filter, setFilter] = useState<"all" | ProjectMode>("all");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ProjectSummary[]>([]);
  const [expandedProjectId, setExpandedProjectId] = useState<string>();
  const [versionsByProject, setVersionsByProject] = useState<
    Record<string, SourceVersionSummary[]>
  >({});
  const [versionErrors, setVersionErrors] = useState<Record<string, string>>(
    {},
  );
  const [loadingVersions, setLoadingVersions] = useState<string>();
  const [reloadVersion, setReloadVersion] = useState(0);
  const [state, setState] = useState<DemoState>(
    authenticated ? "loading" : "empty",
  );
  const [actionError, setActionError] = useState<string>();
  const { requestConfirmation, confirmationDialog } = useConfirmation();

  useEffect(() => {
    if (authenticated) {
      setState("loading");
    } else {
      setItems([]);
      setState("empty");
    }
  }, [authenticated]);

  useResourcePolling({
    enabled: authenticated,
    resourceKey: "projects:list",
    revision: reloadVersion,
    intervalMs: 3_000,
    load: listProjects,
    shouldPoll: (projects) =>
      projects.some((project) => liveProjectStatuses.has(project.status)),
    onSuccess: (projects) => {
      setItems(projects);
      setState(projects.length ? "ready" : "empty");
    },
    onError: (error) => {
      setState("error");
      if (error instanceof ApiError && error.status === 401) onRequireAuth();
    },
  });

  const debouncedQuery = useDebounce(query, 250);
  const filtered = useMemo(
    () =>
      items.filter(
        (project) =>
          (filter === "all" || project.kind === filter) &&
          project.name.toLocaleLowerCase().includes(debouncedQuery.toLocaleLowerCase()),
      ),
    [filter, items, debouncedQuery],
  );

  const loadVersions = async (projectId: string) => {
    setVersionErrors((current) => {
      const next = { ...current };
      delete next[projectId];
      return next;
    });
    setLoadingVersions(projectId);
    try {
      const versions = await listSourceVersions(projectId);
      setVersionsByProject((current) => ({
        ...current,
        [projectId]: versions,
      }));
    } catch (error) {
      setVersionErrors((current) => ({
        ...current,
        [projectId]:
          error instanceof Error
            ? error.message
            : "تعذر تحميل إصدارات المصدر.",
      }));
    } finally {
      setLoadingVersions((current) =>
        current === projectId ? undefined : current,
      );
    }
  };

  const toggleVersions = async (projectId: string) => {
    if (expandedProjectId === projectId) {
      setExpandedProjectId(undefined);
      return;
    }
    setExpandedProjectId(projectId);
    if (versionsByProject[projectId]) return;
    await loadVersions(projectId);
  };

  const removeEmptyDraft = async (project: ProjectSummary) => {
    const confirmed = await requestConfirmation({
      title: "حذف المسودة الفارغة؟",
      description:
        "سيُحذف سجل المشروع فقط بعد أن يؤكد الخادم أنه لم يبدأ أي رفع أو معالجة.",
      confirmLabel: "حذف المسودة",
      cancelLabel: "إبقاء المشروع",
      tone: "danger",
    });
    if (!confirmed) return;
    setActionError(undefined);
    try {
      await deleteEmptyProject(project.id);
      const next = items.filter((item) => item.id !== project.id);
      setItems(next);
      setState(next.length ? "ready" : "empty");
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "تعذر حذف المسودة الفارغة.",
      );
    }
  };

  return (
    <div className="projects-view page-enter">
      <section className="page-title-row">
        <div><span className="eyebrow">مكتبة العمل</span><h1>المشاريع</h1><p>كل أصل من الملف المصدر حتى النسخة الجاهزة لـ Adobe.</p></div>
        <button className="primary-button" type="button" onClick={() => onOpenWorkspace("image")}><Icon name="plus" size={18} /> مشروع جديد</button>
      </section>

      <div className="projects-toolbar">
        <div className="filter-tabs" role="group" aria-label="تصفية المشاريع">
          {([
            ["all", "الكل"],
            ["image", "الصور"],
            ["book", "PDF"],
          ] as const).map(([id, label]) => (
            <button key={id} aria-pressed={filter === id} className={filter === id ? "is-active" : ""} type="button" onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
        <label className="project-search"><Icon name="search" size={17} /><span className="sr-only">بحث</span><input type="search" placeholder="ابحث باسم المشروع" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      </div>

      {actionError && <p className="form-error" role="alert">{actionError}</p>}

      {demoState === "ready" && state === "ready" ? (
        <section className="project-list">
          {filtered.length === 0 ? (
            <div className="data-state project-filter-empty" role="status">
              <span className="state-icon"><Icon name="fileSearch" size={23} /></span>
              <div>
                <strong>لا توجد مشروعات تطابق البحث</strong>
                <p>جرّب عبارة أخرى أو امسح عوامل التصفية لعرض كل المشروعات.</p>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setFilter("all");
                  setQuery("");
                }}
              >
                مسح عوامل التصفية
              </button>
            </div>
          ) : filtered.map((project) => (
            <Fragment key={project.id}>
              <article className="project-row">
                <button className={`project-preview project-preview--${project.kind}`} type="button" onClick={() => onOpenWorkspace(project.kind, {
                  id: project.id,
                  name: project.name,
                  currentSourceVersionId: project.currentSourceVersionId,
                  currentSourceVersionNumber: project.currentSourceVersionNumber,
                })} aria-label={`فتح ${project.name}`}>
                  <Icon name={project.kind === "image" ? "image" : "scan"} size={26} />
                </button>
                <div className="project-info"><strong>{project.name}</strong><small>{project.kind === "image" ? "مصدر صورة" : "مستند PDF"}{project.currentSourceVersionNumber ? ` · v${project.currentSourceVersionNumber}` : ""}</small></div>
                <div className="project-progress"><span><i style={{ width: `${progressFor(project.status)}%` }} /></span><small>{progressFor(project.status)}%</small></div>
                <span className={`status status--${project.status}`}>{statusLabel[project.status]}</span>
                <span className="project-updated">{formatDateTime(project.updatedAt)}</span>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => void toggleVersions(project.id)}
                  aria-expanded={expandedProjectId === project.id}
                  aria-label="إصدارات المصدر"
                  title="إصدارات المصدر"
                >
                  <Icon name="history" size={18} />
                </button>
                {project.status === "draft" &&
                  !project.currentSourceVersionId && (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => void removeEmptyDraft(project)}
                    >
                      حذف
                    </button>
                  )}
              </article>
              {expandedProjectId === project.id && (
                <section className="project-version-panel" aria-label={`إصدارات ${project.name}`}>
                  {loadingVersions === project.id ? (
                    <span className="version-loading"><Icon name="refresh" size={15} /> جارٍ تحميل الإصدارات…</span>
                  ) : versionErrors[project.id] ? (
                    <span className="version-loading" role="alert">
                      {versionErrors[project.id]}
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => void loadVersions(project.id)}
                      >
                        إعادة المحاولة
                      </button>
                    </span>
                  ) : (versionsByProject[project.id] ?? []).length > 0 ? (
                    (versionsByProject[project.id] ?? []).map((version) => (
                      <article className="source-version-row" key={version.id}>
                        <b dir="ltr">v{version.versionNumber}</b>
                        <span><strong>{version.filename}</strong><small>{formatBytes(version.sizeBytes)} · {sourceStatusLabel[version.status]} · {formatDateTime(version.updatedAt)}</small></span>
                        <button
                          className="text-button"
                          type="button"
                          disabled={version.status !== "ready"}
                          onClick={() => onOpenWorkspace(project.kind, {
                            id: project.id,
                            name: project.name,
                            currentSourceVersionId: version.id,
                            currentSourceVersionNumber: version.versionNumber,
                          })}
                        >
                          فتح
                        </button>
                      </article>
                    ))
                  ) : (
                    <span className="version-loading">لا توجد إصدارات قابلة للعرض.</span>
                  )}
                </section>
              )}
            </Fragment>
          ))}
        </section>
      ) : (
        <DataState
          state={
            demoState !== "ready"
              ? demoState
              : state === "ready"
                ? "empty"
                : state
          }
          onRetry={() => setReloadVersion((version) => version + 1)}
        />
      )}
      {confirmationDialog}
    </div>
  );
}

const sourceStatusLabel: Record<SourceVersionSummary["status"], string> = {
  validating: "تحقق",
  uploading: "رفع",
  verifying: "مراجعة",
  ready: "جاهز",
  failed: "فشل",
  cancelled: "ملغى",
};

function progressFor(status: ProjectSummary["status"]): number {
  return {
    draft: 10,
    validating: 20,
    uploading: 35,
    queued: 45,
    processing: 60,
    needs_review: 75,
    approved: 85,
    exporting: 92,
    completed: 100,
    failed: 0,
    cancelled: 0,
  }[status];
}
