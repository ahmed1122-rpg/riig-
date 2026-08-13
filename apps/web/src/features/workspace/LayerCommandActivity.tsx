import { Icon } from "../../shared/Icon";
import type {
  LayerCommandLogEntry,
  LayerNormalizePreview,
} from "./useLayerCommandWorkflow";

export function LayerCommandActivity({
  preview,
  log,
  onConfirm,
  onCancel,
}: {
  preview: LayerNormalizePreview | undefined;
  log: readonly LayerCommandLogEntry[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!preview && log.length === 0) return null;
  return (
    <div className="pro-layer-command-activity">
      {preview && (
        <section className="pro-layer-name-preview" aria-label="معاينة توحيد الأسماء">
          <header><strong>معاينة فرق الأسماء</strong><span>{preview.affectedCount} ضمن النطاق</span></header>
          {preview.exceedsLimit ? (
            <p role="alert">النطاق أكبر من 5000 طبقة. حدّد مجموعة أصغر ثم أعد المحاولة.</p>
          ) : preview.changes.length === 0 ? (
            <p>الأسماء مطبّعة وفريدة بالفعل؛ لن يتغير شيء.</p>
          ) : (
            <ul>
              {preview.changes.slice(0, 8).map((change) => (
                <li key={change.id}><del dir="auto">{change.before}</del><Icon name="arrow" size={12} /><ins dir="auto">{change.after}</ins></li>
              ))}
            </ul>
          )}
          {preview.changes.length > 8 && <small>و{preview.changes.length - 8} تغييرات أخرى</small>}
          <footer>
            <button type="button" onClick={onCancel}>إلغاء</button>
            <button type="button" disabled={preview.exceedsLimit || preview.changes.length === 0} onClick={onConfirm}>تطبيق {preview.changes.length} تغييرات</button>
          </footer>
        </section>
      )}
      {log.length > 0 && (
        <details className="pro-layer-command-log">
          <summary>سجل أوامر الجلسة <span>{log.length}</span></summary>
          <ol>
            {log.map((entry) => (
              <li key={entry.id} className={`is-${entry.status}`}>
                <Icon name={entry.status === "failed" ? "warning" : entry.status === "succeeded" ? "check" : "refresh"} size={12} />
                <span>{entry.label}</span>
                <small>{entry.status === "failed" ? "فشل" : entry.status === "succeeded" ? "اكتمل" : "جارٍ"}</small>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
