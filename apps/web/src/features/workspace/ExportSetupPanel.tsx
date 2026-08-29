import type { ExportFormat } from "@motionprep/contracts";
import { Icon } from "../../shared/Icon";
import type { ProjectMode } from "../../types";
import type { ExportPreflightResult } from "./exportPreflight";
import type { ExportGenerationState } from "./exportFormatState";
import { ExportQualitySummary } from "./ExportQualitySummary";
import type { FormatOption, PdfScope } from "./exportReviewTypes";
import type { WorkspaceSaveState } from "./WorkspaceChrome";

interface ExportSetupPanelProps {
  mode: ProjectMode;
  maxUploadBytes: number;
  preflight: ExportPreflightResult;
  formats: FormatOption[];
  format: ExportFormat;
  generationState: ExportGenerationState;
  pdfScope: PdfScope;
  page: number;
  pageCount: number;
  namingPresetId: string;
  advancedOpen: boolean;
  saveState: WorkspaceSaveState;
  onRetrySave: (() => Promise<void>) | undefined;
  onFormatChange: (format: ExportFormat) => void;
  onPdfScopeChange: (scope: PdfScope) => void;
  onAdvancedOpenChange: (open: boolean) => void;
  onRetryError: (message: string) => void;
}

export function ExportSetupPanel({
  mode,
  maxUploadBytes,
  preflight,
  formats,
  format,
  generationState,
  pdfScope,
  page,
  pageCount,
  namingPresetId,
  advancedOpen,
  saveState,
  onRetrySave,
  onFormatChange,
  onPdfScopeChange,
  onAdvancedOpenChange,
  onRetryError,
}: ExportSetupPanelProps) {
  const working = generationState === "working";
  return (
    <aside className="export-setup-panel" aria-label="إعداد التصدير">
      <div className="export-setup-scroll">
        <ExportQualitySummary
          mode={mode}
          maxUploadBytes={maxUploadBytes}
          preflight={preflight}
        />

        <div className="export-setup">
          <div className="review-section-heading">
            <div><strong>إعداد التصدير</strong><small>الخيارات الأساسية فقط</small></div>
          </div>
          <fieldset className="format-options">
            <legend>الصيغة</legend>
            {formats.map((item) => (
              <label key={item.id} className={format === item.id ? "is-selected" : ""}>
                <input
                  type="radio"
                  name="export-format"
                  value={item.id}
                  checked={format === item.id}
                  onChange={() => onFormatChange(item.id)}
                  disabled={working}
                />
                <span><strong>{item.title}</strong><small>{item.hint}</small></span>
              </label>
            ))}
          </fieldset>

          {mode === "book" && format === "psd" ? (
            <fieldset className="scope-options">
              <legend>نطاق الإخراج</legend>
              <ScopeOption
                checked={pdfScope === "document"}
                disabled={working}
                title="PSD واحد للمستند"
                hint="كل الصفحات في ملف واحد"
                onChange={() => onPdfScopeChange("document")}
              />
              <ScopeOption
                checked={pdfScope === "pages"}
                disabled={working}
                title="PSD لكل صفحة"
                hint="موصى به للأداء وسهولة التحريك"
                onChange={() => onPdfScopeChange("pages")}
              />
              <ScopeOption
                checked={pdfScope === "selected"}
                disabled={working}
                title="الصفحة الحالية فقط"
                hint={`الصفحة ${page} من ${pageCount}`}
                onChange={() => onPdfScopeChange("selected")}
              />
            </fieldset>
          ) : null}

          <div className="export-fields">
            <div><span>الدقة الفعلية</span><output>الحجم الأصلي · 1×</output></div>
            <div><span>ملف الألوان</span><output>sRGB IEC61966-2.1</output></div>
            <div><span>قالب الوثيقة</span><output>{namingPresetId}</output></div>
          </div>

          <button
            className="advanced-export-toggle"
            type="button"
            onClick={() => onAdvancedOpenChange(!advancedOpen)}
            aria-expanded={advancedOpen}
          >
            <Icon name="filter" size={15} />
            خيارات متقدمة
            <Icon name="chevron" size={14} />
          </button>
          {advancedOpen ? (
            <div className="advanced-export-options">
              <span><Icon name="check" size={13} /> تُحفظ بيانات الموضع داخل الملف أو manifest بحسب الصيغة.</span>
              <span><Icon name="check" size={13} /> تُنشئ الصيغ الحزمية manifest تلقائيًا دون خيار وهمي لتعطيله.</span>
            </div>
          ) : null}
        </div>

        <div className="export-estimate">
          <div><span>الحجم</span><strong>يُحسب بعد الإنشاء</strong></div>
          <div><span>الوقت</span><strong>حسب حجم المصدر</strong></div>
        </div>

        <div className="local-demo-note">
          <Icon name="info" size={14} />
          <span>
            للصور: PSD وTIFF وPNG الشفافة وPNG + JSON. بالنسبة إلى PDF: PSD
            وPNG + JSON وTXT وCSV وJSON؛ وتُرسم نصوص PSD كطبقات Raster لتجنب
            اختلاف الخطوط بين الأجهزة.
          </span>
        </div>
        <SaveStateNotice
          saveState={saveState}
          onRetrySave={onRetrySave}
          onRetryError={onRetryError}
        />
      </div>
    </aside>
  );
}

function ScopeOption({
  checked,
  disabled,
  title,
  hint,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  title: string;
  hint: string;
  onChange: () => void;
}) {
  return (
    <label className={checked ? "is-selected" : ""}>
      <input type="radio" checked={checked} onChange={onChange} disabled={disabled} />
      <span><strong>{title}</strong><small>{hint}</small></span>
    </label>
  );
}

function SaveStateNotice({
  saveState,
  onRetrySave,
  onRetryError,
}: {
  saveState: WorkspaceSaveState;
  onRetrySave: (() => Promise<void>) | undefined;
  onRetryError: (message: string) => void;
}) {
  if (saveState === "saved") return null;
  const message =
    saveState === "error"
      ? "لم تُحفظ مراجعة الطبقات الأخيرة."
      : saveState === "conflict"
        ? "توجد نسخة أحدث. أعد تحميل المشروع لحماية تعديلاتك."
        : saveState === "saving"
          ? "جارٍ حفظ مراجعة الطبقات…"
          : saveState === "unavailable"
            ? "الحفظ غير متاح قبل تجهيز المصدر."
            : "توجد تغييرات تنتظر الحفظ، وستُحفظ قبل إنشاء الملف.";
  return (
    <div className={`export-save-state is-${saveState}`} role="status">
      <span>{message}</span>
      {saveState === "error" && onRetrySave ? (
        <button
          type="button"
          onClick={() => {
            void onRetrySave().catch((error: unknown) => {
              onRetryError(
                error instanceof Error ? error.message : "تعذر إعادة الحفظ.",
              );
            });
          }}
        >
          إعادة الحفظ
        </button>
      ) : null}
    </div>
  );
}
