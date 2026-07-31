import { Fragment, useEffect, useMemo, useState } from "react";
import { DataState } from "../../shared/DataState";
import { formatBytes, formatDateTime } from "../../shared/formatters";
import { Icon } from "../../shared/Icon";
import type { DemoState, ProjectMode } from "../../types";
import {
  ApiError,
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

  useEffect(() => {
    if (!authenticated) {
      setItems([]);
      setState("empty");
      return;
    }
    let active = true;
    setState("loading");
    void listProjects()
      .then((projects) => {
        if (!active) return;
        setItems(projects);
        setState(projects.length ? "ready" : "empty");
      })
      .catch((error) => {
        if (!active) return;
        setState("error");
        if (error instanceof ApiError && error.status === 401) onRequireAuth();
      });
    return () => {
      active = false;
    };
  }, [authenticated, onRequireAuth, reloadVersion]);

  const filtered = useMemo(
    () =>
      items.filter(
        (project) =>
          (filter === "all" || project.kind === filter) &&
          project.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      ),
    [filter, items, query],
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

      {demoState === "ready" && state === "ready" ? (
        <section className="project-list">
          {filtered.map((project) => (
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
