import { type MouseEvent, type RefObject } from "react";
import { MAX_IMAGE_LAYERS } from "@motionprep/contracts";
import { Icon } from "../../shared/Icon";
import type { PdfSegmentation, ProjectMode } from "../../types";
import { pdfSegmentationLabels } from "./pdfSegmentation";
import type { WorkspaceMobilePanel } from "./workspaceMobilePanel";

export type WorkspaceSaveState =
  | "unavailable"
  | "dirty"
  | "saving"
  | "saved"
  | "conflict"
  | "error";

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
  activePdfPage = 1,
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
  activePdfPage?: number;
  pdfPageCount: number;
  pdfMode: PdfSegmentation;
  exportTriggerRef: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
  onModeChange: (mode: ProjectMode) => Promise<void>;
  onExport: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const projectName = persistedSource
    ? sourceName.replace(/\.[^.]+$/, "")
    : mode === "image"
      ? "مشروع صورة جديد"
      : "مشروع PDF جديد";
  const saveLabel = !persistedSource
    ? "ارفع المصدر لبدء الحفظ"
    : saveState === "unavailable"
      ? "الحفظ غير متاح مؤقتًا"
      : saveState === "dirty"
        ? "تعديلات بانتظار الحفظ"
        : saveState === "saving"
          ? "جارٍ حفظ المراجعة"
          : saveState === "conflict"
            ? "توجد نسخة أحدث تحتاج المراجعة"
            : saveState === "error"
              ? "تعذر حفظ آخر تعديل"
              : "كل التعديلات محفوظة";

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
          <h1>{projectName}</h1>
          <span
            className={`save-state is-${saveState}`}
            role="status"
            aria-live="polite"
          >
            <i /> {saveLabel}
          </span>
        </div>
      </div>
      <div
        className="workspace-mode"
        role="group"
        aria-label="نوع التجهيز"
      >
        <button
          type="button"
          aria-pressed={mode === "image"}
          className={mode === "image" ? "is-active" : ""}
          onClick={() => void onModeChange("image")}
        >
          <Icon name="image" size={16} /> صورة
        </button>
        <button
          type="button"
          aria-pressed={mode === "book"}
          className={mode === "book" ? "is-active" : ""}
          onClick={() => void onModeChange("book")}
        >
          <Icon name="scan" size={16} /> PDF
        </button>
      </div>
      <div className="workspace-meta">
        <span
          className={
            mode === "image" && imageLayerCount >= MAX_IMAGE_LAYERS
              ? "layer-counter is-full"
              : "layer-counter"
          }
        >
          <Icon name="layers" size={15} />
          {mode === "image" ? (
            <>
              <b dir="ltr">{imageLayerCount} / {MAX_IMAGE_LAYERS}</b>
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
  pdfPageSize,
  zoom,
  activeLayerName,
}: {
  saveState: WorkspaceSaveState;
  persistedSource: boolean;
  sourceVersion: number;
  processing: boolean;
  mode: ProjectMode;
  imageCanvasSize?: { width: number; height: number };
  pdfPageSize?: { width: number; height: number };
  zoom: number;
  activeLayerName?: string;
}) {
  const saveLabel = !persistedSource
    ? "لا يوجد مصدر"
    : saveState === "unavailable"
      ? "الحفظ غير متاح"
      : saveState === "dirty"
        ? "بانتظار الحفظ"
        : saveState === "saving"
          ? "جارٍ الحفظ"
          : saveState === "conflict"
            ? "تعارض نسخة"
            : saveState === "error"
              ? "خطأ في الحفظ"
              : "محفوظ";
  const processLabel = processing
    ? "معالجة موضعية"
    : persistedSource
      ? "جاهز للمراجعة"
      : "ابدأ باختيار ملف";

  return (
    <div
      className="pro-status-bar"
      role="status"
      aria-live="polite"
      aria-label="حالة مساحة العمل"
    >
      <span>
        <i className={`is-${saveState}`} />{" "}
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
      <span dir={mode === "book" && !pdfPageSize ? "rtl" : "ltr"}>
        {mode === "image" && imageCanvasSize
          ? `${imageCanvasSize.width} × ${imageCanvasSize.height} px`
          : mode === "book" && pdfPageSize
            ? `${Math.round(pdfPageSize.width)} × ${Math.round(pdfPageSize.height)} pt`
            : persistedSource
              ? "أبعاد الصفحة غير متاحة"
              : "—"}
      </span>
      <span dir="ltr">{zoom}%</span>
      <span dir="ltr">RGB · sRGB</span>
      <strong>{activeLayerName}</strong>
    </div>
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
