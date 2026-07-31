import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  listSourceVersionRestores,
  listSourceVersions,
  restoreSourceVersion,
  type SourceVersionRestoreResult,
  type SourceVersionSummary,
} from "../../lib/api";
import { Dialog } from "../../shared/Dialog";
import { Icon } from "../../shared/Icon";

interface SourceVersionHistoryDialogProps {
  projectId: string;
  currentSourceVersionId: string;
  onClose: () => void;
  onRestored: (
    result: SourceVersionRestoreResult,
    version: SourceVersionSummary,
  ) => Promise<void>;
  onNotify: (message: string) => void;
}

export function SourceVersionHistoryDialog({
  projectId,
  currentSourceVersionId,
  onClose,
  onRestored,
  onNotify,
}: SourceVersionHistoryDialogProps) {
  const [versions, setVersions] = useState<SourceVersionSummary[]>([]);
  const [restoreCount, setRestoreCount] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const selected = useMemo(
    () => versions.find((version) => version.id === selectedId),
    [selectedId, versions],
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      listSourceVersions(projectId, controller.signal),
      listSourceVersionRestores(projectId, controller.signal),
    ])
      .then(([loadedVersions, history]) => {
        setVersions(loadedVersions);
        setRestoreCount(history.length);
        setSelectedId(
          loadedVersions.find(
            (version) =>
              version.id !== currentSourceVersionId &&
              version.status === "ready",
          )?.id ?? "",
        );
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "تعذر تحميل إصدارات المصدر.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [currentSourceVersionId, projectId]);

  const restore = async () => {
    if (!selected || selected.status !== "ready" || reason.trim().length < 3) {
      setError("اختر إصدارًا جاهزًا واكتب سببًا واضحًا للاستعادة.");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await restoreSourceVersion(projectId, selected.id, {
        expectedCurrentSourceVersionId: currentSourceVersionId,
        reason: reason.trim(),
      });
      await onRestored(result, selected);
      onNotify(
        `تمت استعادة المصدر v${selected.versionNumber} وحفظ قرار الاستعادة في السجل.`,
      );
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "تعذر استعادة إصدار المصدر.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      title="إصدارات المصدر"
      description="الاستعادة تغيّر مؤشر المصدر الحالي فقط؛ لا تحذف الإصدارات أو التصديرات السابقة."
      className="source-version-dialog"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose}>
            إلغاء
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={
              submitting ||
              !selected ||
              selected.status !== "ready" ||
              reason.trim().length < 3
            }
            onClick={() => void restore()}
          >
            <Icon name="refresh" size={15} />
            {submitting ? "جارٍ الاستعادة…" : "استعادة الإصدار المحدد"}
          </button>
        </>
      }
    >
      <div className="source-version-summary">
        <span>{versions.length} إصدارات محفوظة</span>
        <span>{restoreCount} عمليات استعادة سابقة</span>
      </div>
      {loading ? (
        <p role="status">جارٍ تحميل سجل المصدر…</p>
      ) : (
        <div className="source-version-list" role="radiogroup" aria-label="إصدارات المصدر">
          {versions.map((version) => {
            const current = version.id === currentSourceVersionId;
            const unavailable = version.status !== "ready" || current;
            return (
              <label
                key={version.id}
                className={`source-version-item ${current ? "is-current" : ""}`}
              >
                <input
                  type="radio"
                  name="source-version"
                  value={version.id}
                  checked={selectedId === version.id}
                  disabled={unavailable}
                  onChange={() => setSelectedId(version.id)}
                />
                <span>
                  <strong>v{version.versionNumber} · {version.filename}</strong>
                  <small>
                    {new Date(version.createdAt).toLocaleString("ar-EG")} · {version.status}
                  </small>
                </span>
                {current && <em>الحالي</em>}
              </label>
            );
          })}
        </div>
      )}
      <label className="source-version-reason">
        <span>سبب الاستعادة</span>
        <textarea
          value={reason}
          maxLength={500}
          rows={3}
          placeholder="مثال: العودة إلى النسخة التي اعتمدها فريق المراجعة"
          onChange={(event) => setReason(event.target.value)}
        />
        <small>{reason.trim().length}/500</small>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  );
}
