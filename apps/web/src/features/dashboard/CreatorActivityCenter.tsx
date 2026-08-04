import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowActivityFeed } from "@motionprep/contracts";
import {
  listWorkflowActivity,
  type WorkflowActivityItem,
} from "../../lib/api";
import { DataState } from "../../shared/DataState";
import { formatDateTime } from "../../shared/formatters";
import { Icon } from "../../shared/Icon";
import { getActivityFailureMessage } from "../../shared/workflowFailurePresentation";
import {
  activityActionLabels,
  activityKindPresentation,
  activityStatusLabels,
} from "./activityPresentation";

export const ACTIVITY_POLL_INTERVAL_MS = 5_000;

type ActivityViewState =
  | "loading"
  | "empty"
  | "ready"
  | "error"
  | "unauthenticated";

interface CreatorActivityCenterProps {
  authenticated: boolean;
  onRequireAuth: () => void;
  onOpenProject: (item: WorkflowActivityItem) => void;
  onNavigateProjects: () => void;
  onNavigateExports: () => void;
}

type IncrementalRequest = {
  controller: AbortController;
  mode: "append" | "refresh";
};

export function CreatorActivityCenter({
  authenticated,
  onRequireAuth,
  onOpenProject,
  onNavigateProjects,
  onNavigateExports,
}: CreatorActivityCenterProps) {
  const [feed, setFeed] = useState<WorkflowActivityFeed | null>(null);
  const [viewState, setViewState] =
    useState<ActivityViewState>(authenticated ? "loading" : "unauthenticated");
  const [initialError, setInitialError] = useState<string>();
  const [incrementalError, setIncrementalError] = useState<string>();
  const [refreshWarning, setRefreshWarning] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const incrementalRequestRef = useRef<IncrementalRequest | null>(null);

  useEffect(() => {
    if (!authenticated) {
      incrementalRequestRef.current?.controller.abort();
      setFeed(null);
      setViewState("unauthenticated");
      setInitialError(undefined);
      setIncrementalError(undefined);
      setRefreshWarning(undefined);
      setLoadingMore(false);
      return;
    }

    const controller = new AbortController();
    setViewState("loading");
    setInitialError(undefined);
    setIncrementalError(undefined);
    void listWorkflowActivity({ signal: controller.signal })
      .then((nextFeed) => {
        if (controller.signal.aborted) return;
        setFeed(nextFeed);
        setViewState(nextFeed.items.length > 0 ? "ready" : "empty");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setInitialError(
          error instanceof Error ? error.message : "تعذر تحميل نشاط الإنتاج.",
        );
        setViewState("error");
      });
    return () => controller.abort();
  }, [authenticated, retryVersion]);

  const requestIncrementalPage = useCallback(
    async (mode: "append" | "refresh", cursor?: string) => {
      if (incrementalRequestRef.current) return;
      const controller = new AbortController();
      incrementalRequestRef.current = { controller, mode };
      if (mode === "append") {
        setLoadingMore(true);
        setIncrementalError(undefined);
      } else {
        setRefreshWarning(undefined);
      }

      try {
        const nextFeed = await listWorkflowActivity({
          ...(cursor ? { cursor } : {}),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setFeed((current) => {
          if (!current) return nextFeed;
          return {
            items: mergeActivityItems(current.items, nextFeed.items),
            summary: nextFeed.summary,
            // Activity cursors are stable updatedAt/id boundaries. A first-page
            // refresh must not move an already loaded append frontier backwards.
            nextCursor:
              mode === "append"
                ? nextFeed.nextCursor
                : current.nextCursor,
            generatedAt: nextFeed.generatedAt,
          };
        });
        setViewState((current) =>
          current === "empty" && nextFeed.items.length > 0 ? "ready" : current,
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        const message =
          error instanceof Error ? error.message : "تعذر تحديث النشاط.";
        if (mode === "append") {
          setIncrementalError(message);
        } else {
          setRefreshWarning(
            "تعذر تحديث النشاط الآن؛ البيانات المعروضة هي آخر نسخة متاحة.",
          );
        }
      } finally {
        if (incrementalRequestRef.current?.controller === controller) {
          incrementalRequestRef.current = null;
        }
        if (!controller.signal.aborted && mode === "append") {
          setLoadingMore(false);
        }
      }
    },
    [],
  );

  const containsActiveWork = useMemo(
    () =>
      feed?.items.some((item) =>
        item.status === "pending" || item.status === "running",
      ) ?? false,
    [feed?.items],
  );

  useEffect(() => {
    if (!authenticated || !containsActiveWork) return;
    let timer: number | undefined;
    let stopped = false;

    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      if (
        stopped ||
        timer !== undefined ||
        document.visibilityState !== "visible"
      ) {
        return;
      }
      timer = window.setTimeout(() => {
        timer = undefined;
        if (document.visibilityState !== "visible") return;
        void requestIncrementalPage("refresh").finally(schedule);
      }, ACTIVITY_POLL_INTERVAL_MS);
    };
    const handleVisibilityChange = () => {
      clearTimer();
      if (document.visibilityState !== "visible") {
        const request = incrementalRequestRef.current;
        if (request?.mode === "refresh") request.controller.abort();
        return;
      }
      schedule();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    schedule();
    return () => {
      stopped = true;
      clearTimer();
      const request = incrementalRequestRef.current;
      if (request?.mode === "refresh") request.controller.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [authenticated, containsActiveWork, requestIncrementalPage]);

  useEffect(
    () => () => incrementalRequestRef.current?.controller.abort(),
    [],
  );

  const runAction = (item: WorkflowActivityItem) => {
    if (item.recommendedAction === "view-exports") {
      onNavigateExports();
      return;
    }
    onOpenProject(item);
  };

  return (
    <section className="activity-center" aria-labelledby="activity-title">
      <header className="activity-center__header">
        <div>
          <span className="eyebrow">سجل حسابك</span>
          <h2 id="activity-title">النشاط والإنتاج</h2>
        </div>
        <small>
          {feed
            ? `آخر تحديث ${formatDateTime(feed.generatedAt)}`
            : "المهام الحديثة والحالات التي تحتاج تدخلك"}
        </small>
      </header>

      {feed && (
        <dl className="activity-summary" aria-label="ملخص نشاط المشاريع">
          <div className="is-active">
            <dt>نشط الآن</dt>
            <dd>{feed.summary.active}</dd>
          </div>
          <div className="is-attention">
            <dt>يحتاج مراجعة</dt>
            <dd>{feed.summary.needsAttention}</dd>
          </div>
          <div className="is-failed">
            <dt>فشل</dt>
            <dd>{feed.summary.failed}</dd>
          </div>
        </dl>
      )}

      {viewState === "loading" && (
        <DataState
          state="loading"
          compact
          title="جارٍ تحميل نشاطك"
          description="نجمع آخر حالات الرفع والمعالجة والمراجعة والتصدير."
        />
      )}
      {viewState === "error" && (
        <DataState
          state="error"
          compact
          title="تعذر تحميل النشاط"
          {...(initialError ? { description: initialError } : {})}
          onRetry={() => setRetryVersion((version) => version + 1)}
        />
      )}
      {viewState === "unauthenticated" && (
        <div className="activity-auth-state">
          <span className="state-icon"><Icon name="login" size={22} /></span>
          <div>
            <strong>سجّل الدخول لعرض نشاطك</strong>
            <p>لن نطلب بيانات النشاط قبل فتح جلسة آمنة لحسابك.</p>
          </div>
          <button className="primary-button" type="button" onClick={onRequireAuth}>
            <Icon name="login" size={16} /> تسجيل الدخول
          </button>
        </div>
      )}
      {viewState === "empty" && (
        <DataState
          state="empty"
          compact
          title="لا يوجد نشاط إنتاج بعد"
          description="ابدأ مشروعًا، وستظهر هنا مراحله الفعلية من الرفع حتى التصدير."
        />
      )}

      {viewState === "ready" && feed && (
        <div className="activity-list" aria-label="آخر أنشطة الإنتاج">
          {feed.items.map((item) => {
            const phase = activityKindPresentation[item.kind];
            return (
              <article
                className={`activity-row is-${item.status}`}
                data-testid={`activity-${item.id}`}
                key={item.id}
              >
                <span className="activity-row__icon"><Icon name={phase.icon} size={18} /></span>
                <div className="activity-row__main">
                  <div>
                    <span>{phase.label}</span>
                    <strong>{item.project.name}</strong>
                  </div>
                  {item.status === "failed" && (
                    <p className="activity-row__error">
                      <span>{getActivityFailureMessage(item)}</span>
                      {item.errorCode && <code dir="ltr">{item.errorCode}</code>}
                    </p>
                  )}
                  {item.progress !== null && (
                    <div
                      className="activity-row__progress"
                      aria-label={`التقدم ${item.progress}%`}
                    >
                      <span>
                        <i
                          style={{
                            width: `${Math.max(0, Math.min(100, item.progress))}%`,
                          }}
                        />
                      </span>
                      <small>{item.progress}%</small>
                    </div>
                  )}
                </div>
                <div className="activity-row__state">
                  <span className={`activity-status is-${item.status}`}>
                    {activityStatusLabels[item.status]}
                  </span>
                  <time dateTime={item.updatedAt}>{formatDateTime(item.updatedAt)}</time>
                </div>
                <button
                  className="secondary-button activity-row__action"
                  type="button"
                  onClick={() => runAction(item)}
                >
                  {activityActionLabels[item.recommendedAction]}
                  <Icon name="arrow" size={14} />
                </button>
              </article>
            );
          })}
        </div>
      )}

      {refreshWarning && (
        <p className="activity-refresh-warning" role="status">
          <Icon name="warning" size={14} /> {refreshWarning}
        </p>
      )}
      {incrementalError && (
        <div className="activity-pagination-error" role="alert">
          <span>{incrementalError}</span>
          <button
            className="text-button"
            type="button"
            disabled={!feed?.nextCursor || loadingMore}
            onClick={() => {
              if (feed?.nextCursor) {
                void requestIncrementalPage("append", feed.nextCursor);
              }
            }}
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      <footer className="activity-center__footer">
        <div>
          <button className="text-button" type="button" onClick={onNavigateProjects}>
            كل المشاريع
          </button>
          <button className="text-button" type="button" onClick={onNavigateExports}>
            كل التصديرات
          </button>
        </div>
        {feed?.nextCursor && !incrementalError && (
          <button
            className="secondary-button"
            type="button"
            disabled={loadingMore}
            onClick={() =>
              void requestIncrementalPage("append", feed.nextCursor ?? undefined)
            }
          >
            <Icon name={loadingMore ? "refresh" : "arrowDown"} size={15} />
            {loadingMore ? "جارٍ التحميل…" : "تحميل المزيد"}
          </button>
        )}
      </footer>
    </section>
  );
}

function mergeActivityItems(
  current: readonly WorkflowActivityItem[],
  incoming: readonly WorkflowActivityItem[],
): WorkflowActivityItem[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    const previous = byId.get(item.id);
    if (!previous || item.updatedAt >= previous.updatedAt) byId.set(item.id, item);
  }
  return [...byId.values()].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.id.localeCompare(left.id),
  );
}
