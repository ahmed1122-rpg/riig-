import type { MouseEvent, RefObject } from "react";
import { Icon } from "../../shared/Icon";
import type { Layer, PdfSegmentation, ProjectMode } from "../../types";
import type { getLayerCheckSummary } from "./layerChecks";
import { pdfSegmentationLabels } from "./pdfSegmentation";
import type {
  ReadyWorkspaceToolId,
  ResolvedWorkspaceTool,
} from "./workspaceToolRegistry";

export type WorkspaceSaveState =
  | "idle"
  | "saving"
  | "saved"
  | "error";
export type WorkspaceMobilePanel =
  | "none"
  | "tools"
  | "layers"
  | "checks";

export interface WorkspacePipelineStep {
  name: string;
  output: string;
}

export function WorkspaceHeader({
  mode,
  persistedSource,
  sourceName,
  saveState,
  imageLayerCount,
  activePdfPage,
  pdfPageCount,
  pdfMode,
  exportTriggerRef,
  onBack,
  onModeChange,
  onExport,
}: {
  mode: ProjectMode;
  persistedSource: boolean;
  sourceName: string;
  saveState: WorkspaceSaveState;
  imageLayerCount: number;
  activePdfPage: number;
  pdfPageCount: number;
  pdfMode: PdfSegmentation;
  exportTriggerRef: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
  onModeChange: (mode: ProjectMode) => void;
  onExport: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const projectName = persistedSource
    ? sourceName.replace(/\.[^.]+$/, "")
    : mode === "image"
      ? "مشروع صورة جديد"
      : "مشروع PDF جديد";
  const saveLabel = persistedSource
    ? saveState === "saving"
      ? "جارٍ حفظ المراجعة"
      : saveState === "error"
        ? "تعذر حفظ آخر تعديل"
        : "كل التعديلات محفوظة"
    : "ارفع المصدر لبدء الحفظ";

  return (
    <header className="workspace-header pro-workspace-header">
      <div className="workspace-title">
        <button
          className="icon-button"
          type="button"
          onClick={onBack}
          aria-label="العودة إلى الرئيسية"
          title="العودة"
        >
          <Icon name="arrow" size={18} />
        </button>
        <div>
          <strong>{projectName}</strong>
          <span>
            <i /> {saveLabel}
          </span>
        </div>
      </div>
      <div
        className="workspace-mode"
        role="tablist"
        aria-label="نوع التجهيز"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "image"}
          className={mode === "image" ? "is-active" : ""}
          onClick={() => onModeChange("image")}
        >
          <Icon name="image" size={16} /> صورة
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "book"}
          className={mode === "book" ? "is-active" : ""}
          onClick={() => onModeChange("book")}
        >
          <Icon name="scan" size={16} /> PDF
        </button>
      </div>
      <div className="workspace-meta">
        <span
          className={
            mode === "image" && imageLayerCount >= 15
              ? "layer-counter is-full"
              : "layer-counter"
          }
        >
          <Icon name="layers" size={15} />
          {mode === "image" ? (
            <>
              <b dir="ltr">{imageLayerCount} / 15</b>
              <span>طبقة</span>
            </>
          ) : (
            <>
              صفحة {activePdfPage} / {pdfPageCount} ·{" "}
              {pdfSegmentationLabels[pdfMode]}
            </>
          )}
        </span>
        <button
          ref={exportTriggerRef}
          className="primary-button export-button"
          type="button"
          disabled={!persistedSource || saveState === "saving"}
          onClick={onExport}
        >
          <Icon name="download" size={17} /> مراجعة وتصدير
        </button>
      </div>
    </header>
  );
}

export function WorkspacePipeline({
  steps,
  persistedSource,
}: {
  steps: readonly WorkspacePipelineStep[];
  persistedSource: boolean;
}) {
  return (
    <div
      className="workspace-progress pro-workspace-progress"
      aria-label="مراحل الإنتاج"
    >
      {steps.map((step, index) => {
        const className = persistedSource
          ? index < 2
            ? "is-done"
            : index === 2
              ? "is-current"
              : ""
          : index === 0
            ? "is-current"
            : "";
        return (
          <div key={step.name} className={className}>
            <span>
              {persistedSource && index < 2 ? (
                <Icon name="check" size={12} />
              ) : (
                index + 1
              )}
            </span>
            <div className="stage-copy">
              <strong>{step.name}</strong>
              <small>{step.output}</small>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function WorkspaceStatusBar({
  saveState,
  persistedSource,
  sourceVersion,
  processing,
  mode,
  imageCanvasSize,
  zoom,
  activeLayerName,
}: {
  saveState: WorkspaceSaveState;
  persistedSource: boolean;
  sourceVersion: number;
  processing: boolean;
  mode: ProjectMode;
  imageCanvasSize?: { width: number; height: number };
  zoom: number;
  activeLayerName?: string;
}) {
  const saveLabel = persistedSource
    ? saveState === "saving"
      ? "جارٍ الحفظ"
      : saveState === "error"
        ? "خطأ في الحفظ"
        : "محفوظ"
    : "لا يوجد مصدر";
  const processLabel = processing
    ? "معالجة موضعية"
    : persistedSource
      ? "جاهز للمراجعة"
      : "ابدأ باختيار ملف";

  return (
    <footer
      className="pro-status-bar"
      aria-label="حالة مساحة العمل"
    >
      <span>
        <i
          className={
            saveState === "saving"
              ? "is-processing"
              : persistedSource && saveState !== "error"
                ? "is-saved"
                : ""
          }
        />{" "}
        {saveLabel}
      </span>
      <span>
        <Icon name="refresh" size={12} />{" "}
        {sourceVersion > 0
          ? `المصدر v${sourceVersion}`
          : "بانتظار الرفع"}
      </span>
      <span>
        <i
          className={
            processing
              ? "is-processing"
              : persistedSource
                ? "is-ready"
                : ""
          }
        />{" "}
        {processLabel}
      </span>
      <span dir="ltr">
        {mode === "image" && imageCanvasSize
          ? `${imageCanvasSize.width} × ${imageCanvasSize.height} px`
          : persistedSource
            ? "1920 × 1080 px"
            : "—"}
      </span>
      <span dir="ltr">{zoom}%</span>
      <span dir="ltr">RGB · sRGB</span>
      <strong>{activeLayerName}</strong>
    </footer>
  );
}

export function WorkspaceMobileDock({
  activePanel,
  onPanelChange,
  onExport,
}: {
  activePanel: WorkspaceMobilePanel;
  onPanelChange: (panel: WorkspaceMobilePanel) => void;
  onExport: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const toggle = (panel: Exclude<WorkspaceMobilePanel, "none">) =>
    onPanelChange(activePanel === panel ? "none" : panel);
  return (
    <nav
      className="workspace-mobile-dock pro-mobile-dock"
      aria-label="لوحات مساحة العمل"
    >
      <button
        className={activePanel === "tools" ? "is-active" : ""}
        type="button"
        onClick={() => toggle("tools")}
      >
        <Icon name="pointer" size={18} />
        <span>الأدوات</span>
      </button>
      <button
        className={activePanel === "layers" ? "is-active" : ""}
        type="button"
        onClick={() => toggle("layers")}
      >
        <Icon name="layers" size={18} />
        <span>الطبقات</span>
      </button>
      <button
        className={activePanel === "checks" ? "is-active" : ""}
        type="button"
        onClick={() => toggle("checks")}
      >
        <Icon name="review" size={18} />
        <span>الفحص</span>
      </button>
      <button type="button" onClick={onExport}>
        <Icon name="download" size={18} />
        <span>تصدير</span>
      </button>
    </nav>
  );
}

export function WorkspaceMobileSheet({
  activePanel,
  mode,
  persistedSource,
  tools,
  activeTool,
  layers,
  selectedIds,
  activeLayerId,
  layerCheckSummary,
  onClose,
  onUseTool,
  onSelectLayer,
}: {
  activePanel: Exclude<WorkspaceMobilePanel, "none">;
  mode: ProjectMode;
  persistedSource: boolean;
  tools: readonly ResolvedWorkspaceTool[];
  activeTool: ReadyWorkspaceToolId;
  layers: readonly Layer[];
  selectedIds: readonly string[];
  activeLayerId: string;
  layerCheckSummary: ReturnType<typeof getLayerCheckSummary>;
  onClose: () => void;
  onUseTool: (tool: ResolvedWorkspaceTool) => void;
  onSelectLayer: (layerId: string) => void;
}) {
  const label =
    activePanel === "tools"
      ? "الأدوات"
      : activePanel === "layers"
        ? "الطبقات"
        : "الفحص";
  return (
    <section
      className="mobile-sheet pro-mobile-sheet"
      aria-label={label}
    >
      <button
        className="sheet-handle"
        type="button"
        aria-label="إغلاق اللوحة"
        onClick={onClose}
      />
      {activePanel === "tools" && (
        <div className="mobile-tools-panel">
          {!persistedSource && (
            <p
              id="mobile-tools-prerequisite"
              className="mobile-tools-prerequisite"
            >
              <Icon name="info" size={15} />
              <span>
                <strong>الأدوات بانتظار المصدر</strong> ارفع المصدر
                لتفعيل أدوات التحديد.
              </span>
            </p>
          )}
          <div
            className="mobile-tools"
            aria-describedby={
              !persistedSource
                ? "mobile-tools-prerequisite"
                : undefined
            }
          >
            {tools.map((tool) => (
              <button
                key={tool.id}
                type="button"
                disabled={!tool.available}
                title={
                  tool.available
                    ? tool.label
                    : tool.unavailableReason
                }
                aria-describedby={
                  !tool.available
                    ? "mobile-tools-prerequisite"
                    : undefined
                }
                onClick={() => onUseTool(tool)}
                className={
                  activeTool === tool.id ? "is-active" : ""
                }
              >
                <Icon name={tool.icon} />
                <span>{tool.label}</span>
                {tool.shortcut && <kbd>{tool.shortcut.label}</kbd>}
              </button>
            ))}
          </div>
        </div>
      )}
      {activePanel === "layers" && (
        <div className="pro-mobile-layer-list">
          <header>
            <strong>
              {mode === "image"
                ? `${layers.length} / 15 طبقة`
                : `${layers.length} طبقات · بلا حد`}
            </strong>
            <span>{selectedIds.length} محددة</span>
          </header>
          {layers.slice(0, 8).map((layer) => (
            <button
              key={layer.id}
              type="button"
              className={
                activeLayerId === layer.id ? "is-active" : ""
              }
              onClick={() => onSelectLayer(layer.id)}
            >
              <span style={{ background: layer.color }} />
              <strong>{layer.name}</strong>
              <Icon
                name={
                  layer.locked
                    ? "lock"
                    : layer.visible
                      ? "eye"
                      : "eyeOff"
                }
                size={14}
              />
            </button>
          ))}
        </div>
      )}
      {activePanel === "checks" &&
        (persistedSource ? (
          <div className="pro-mobile-checks">
            <strong>{layerCheckSummary.title}</strong>
            <p>{layerCheckSummary.description}</p>
            {layerCheckSummary.items.map((item) => (
              <p
                key={item.id}
                className={item.valid ? "is-ok" : "is-review"}
              >
                <Icon name={item.icon} size={14} />{" "}
                <span>
                  <b>{item.label}</b> · {item.message}
                </span>
              </p>
            ))}
          </div>
        ) : (
          <div className="pro-mobile-checks">
            <strong>بانتظار المصدر</strong>
            <p>تبدأ الفحوص بعد رفع الملف وتجهيز الطبقات.</p>
          </div>
        ))}
    </section>
  );
}
