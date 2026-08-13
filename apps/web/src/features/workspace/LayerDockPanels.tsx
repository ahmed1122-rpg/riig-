import { memo, useRef } from "react";
import { Icon } from "../../shared/Icon";
import type { Layer, ProjectMode } from "../../types";
import { getLayerCheckSummary } from "./layerChecks";

export interface LayerRowProps {
  layer: Layer;
  selected: boolean;
  active: boolean;
  duplicate: boolean;
  renaming: boolean;
  renameDraft: string;
  renameError: string;
  canReorder: boolean;
  dragging: boolean;
  dragOver: boolean;
  onRenameDraftChange: (value: string) => void;
  onSelect: (event: React.MouseEvent | React.KeyboardEvent) => void;
  onStartRename: () => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  onMove: (direction: -1 | 1) => void;
  onNavigate: (
    direction: "previous" | "next" | "first" | "last",
  ) => void;
  onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

export const LayerRow = memo(function LayerRow({
  layer,
  selected,
  active,
  duplicate,
  renaming,
  renameDraft,
  renameError,
  canReorder,
  dragging,
  dragOver,
  onRenameDraftChange,
  onSelect,
  onStartRename,
  onSaveRename,
  onCancelRename,
  onToggleVisible,
  onToggleLock,
  onMove,
  onNavigate,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: LayerRowProps) {
  const actionsRef = useRef<HTMLDetailsElement>(null);
  const runAction = (action: () => void) => {
    action();
    actionsRef.current?.removeAttribute("open");
  };

  return (
    <div
      className={`pro-layer-row ${selected ? "is-selected" : ""} ${active ? "is-active" : ""} ${layer.kind === "page" ? "is-fixed" : ""} ${dragging ? "is-dragging" : ""} ${dragOver ? "is-drag-over" : ""}`}
      data-layer-id={layer.id}
      role="group"
      aria-label={`${layer.name}، ${selected ? "محددة" : "غير محددة"}`}
      aria-current={active ? "true" : undefined}
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      onDoubleClick={onStartRename}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onKeyDown={(event) => {
        if (canReorder && event.altKey && event.key === "ArrowUp") {
          event.preventDefault();
          onMove(-1);
        }
        if (canReorder && event.altKey && event.key === "ArrowDown") {
          event.preventDefault();
          onMove(1);
        }
        if (!event.altKey && event.key === "ArrowUp") {
          event.preventDefault();
          onNavigate("previous");
        }
        if (!event.altKey && event.key === "ArrowDown") {
          event.preventDefault();
          onNavigate("next");
        }
        if (event.key === "Home") {
          event.preventDefault();
          onNavigate("first");
        }
        if (event.key === "End") {
          event.preventDefault();
          onNavigate("last");
        }
        if (event.key === " ") {
          event.preventDefault();
          onSelect(event);
        }
        if (event.key === "F2" || event.key === "Enter") {
          event.preventDefault();
          onStartRename();
        }
      }}
    >
      <button
        className="pro-layer-grip"
        type="button"
        draggable={canReorder && layer.kind !== "page"}
        aria-label={`سحب ${layer.name}`}
        title={
          canReorder
            ? "اسحب أو استخدم Alt + الأسهم"
            : "إعادة الترتيب غير مدعومة لهذا المصدر"
        }
        disabled={!canReorder || layer.kind === "page"}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <Icon name="grip" size={14} />
      </button>
      <span
        className="pro-layer-thumb"
        style={{ "--layer-color": layer.color } as React.CSSProperties}
      >
        {layer.kind === "text" ? (
          "ن"
        ) : layer.kind === "page" ? (
          <Icon name="scan" size={13} />
        ) : (
          <i />
        )}
      </span>
      <div className="pro-layer-copy">
        {renaming ? (
          <div
            className="pro-inline-rename"
            onClick={(event) => event.stopPropagation()}
          >
            <label>
              <span aria-hidden="true">+</span>
              <input
                autoFocus
                value={renameDraft.replace(/^\++/, "")}
                aria-label={`إعادة تسمية ${layer.name}`}
                aria-invalid={Boolean(renameError)}
                onChange={(event) =>
                  onRenameDraftChange(event.target.value)
                }
                onBlur={(event) => {
                  const editor = event.currentTarget.closest(
                    ".pro-inline-rename",
                  );
                  if (
                    event.relatedTarget instanceof Node &&
                    editor?.contains(event.relatedTarget)
                  ) {
                    return;
                  }
                  onSaveRename();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onSaveRename();
                  if (event.key === "Escape") onCancelRename();
                }}
              />
            </label>
            <button type="button" aria-label="حفظ الاسم" onClick={onSaveRename}>
              <Icon name="check" size={12} />
            </button>
            <button type="button" aria-label="إلغاء التسمية" onClick={onCancelRename}>
              <Icon name="close" size={12} />
            </button>
            {renameError && <small role="alert">{renameError}</small>}
          </div>
        ) : (
          <>
            <strong
              dir={/^[A-Za-z0-9]/.test(layer.name.slice(1)) ? "ltr" : "rtl"}
            >
              {layer.name}
            </strong>
            <span>
              {layer.kind === "page"
                ? "خلفية ثابتة"
                : layer.kind === "text"
                  ? "نص · قابل للتحريك"
                  : `${layer.confidence ?? 94}% · جزء صورة`}
            </span>
          </>
        )}
      </div>
      {duplicate && (
        <span className="pro-layer-warning" title="اسم مكرر">
          <Icon name="warning" size={13} />
        </span>
      )}
      <details
        className="pro-layer-actions"
        ref={actionsRef}
        onClick={(event) => event.stopPropagation()}
      >
        <summary
          role="button"
          aria-haspopup="menu"
          aria-label={`إجراءات الطبقة ${layer.name}`}
          title="إجراءات الطبقة"
        >
          <Icon name="menu" size={15} />
        </summary>
        <div className="pro-layer-actions-menu">
          <button
            type="button"
            onClick={() => runAction(() => onMove(-1))}
            disabled={layer.kind === "page" || !canReorder}
          >
            <Icon name="arrowUp" size={15} />
            نقل لأعلى
          </button>
          <button
            type="button"
            onClick={() => runAction(() => onMove(1))}
            disabled={layer.kind === "page" || !canReorder}
          >
            <Icon name="arrowDown" size={15} />
            نقل لأسفل
          </button>
          <button type="button" onClick={() => runAction(onToggleVisible)} disabled={layer.kind === "page"}>
            <Icon name={layer.visible ? "eyeOff" : "eye"} size={15} />
            {layer.visible ? "إخفاء الطبقة" : "إظهار الطبقة"}
          </button>
          <button
            type="button"
            onClick={() => runAction(onToggleLock)}
            disabled={layer.kind === "page"}
          >
            <Icon name={layer.locked ? "unlock" : "lock"} size={15} />
            {layer.locked ? "فتح القفل" : "قفل الطبقة"}
          </button>
        </div>
      </details>
    </div>
  );
});

export function LayerSkeleton() {
  return (
    <div className="pro-layer-skeleton" aria-label="جارٍ تحميل الطبقات">
      {Array.from({ length: 7 }, (_, index) => (
        <i key={index} />
      ))}
    </div>
  );
}

export function ChecksPanel({
  mode,
  layers,
}: {
  mode: ProjectMode;
  layers: Layer[];
}) {
  const summary = getLayerCheckSummary(mode, layers);
  return (
    <div className="checks-panel pro-checks-panel">
      <div className="check-summary">
        <span><Icon name="review" size={21} /></span>
        <div><strong>{summary.title}</strong><small>{summary.description}</small></div>
      </div>
      <ul>
        {summary.items.map((item) => (
          <li key={item.id} className={item.valid ? "is-ok" : "is-review"}>
            <Icon name={item.icon} size={15} />
            <span><strong>{item.label}</strong><small>{item.message}</small></span>
          </li>
        ))}
      </ul>
      {summary.diagnostics.length > 0 && (
        <details className="pro-layer-diagnostics">
          <summary>تفاصيل التشخيص <span>{summary.diagnostics.length}</span></summary>
          <ol>{summary.diagnostics.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ol>
        </details>
      )}
    </div>
  );
}
