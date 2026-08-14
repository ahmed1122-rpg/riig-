import { Icon } from "../../shared/Icon";
import type { ExportGenerationState } from "./exportFormatState";

export function ExportReviewFooter({
  generationState,
  disabled,
  onCreate,
  message,
  issues,
}: {
  generationState: ExportGenerationState;
  disabled: boolean;
  onCreate: () => void;
  message: string | undefined;
  issues: readonly { key: string; message: string }[];
}) {
  return (
    <footer className="export-action-footer">
      <button
        className={`create-export-button ${generationState === "done" ? "is-done" : ""}`}
        type="button"
        onClick={onCreate}
        disabled={disabled}
      >
        <Icon name={generationState === "done" ? "check" : "download"} size={17} />
        {generationState === "working"
          ? "جارٍ اعتماد المراجعة وتجهيز النسخة…"
          : generationState === "done"
            ? "تم اعتماد المراجعة وإنشاء الملف"
            : "اعتماد المراجعة وإنشاء التصدير"}
      </button>
      {message && (
        <p
          className={`export-generation-message ${generationState === "done" ? "is-success" : "is-error"}`}
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
      )}
      {issues.length > 0 && (
        <ul className="export-preflight-issues" aria-label="موانع التصدير">
          {issues.map((issue) => (
            <li key={issue.key}>
              <Icon name="warning" size={14} />
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
    </footer>
  );
}
