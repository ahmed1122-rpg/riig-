import { useEffect, useRef, useState } from "react";
import { MAX_IMAGE_LAYERS, MAX_IMAGE_UPLOAD_BYTES, MAX_PDF_UPLOAD_BYTES, type ExportFormat, type ProductionIssue } from "@motionprep/contracts";
import { ApiError } from "../../lib/api/transport";
import { Icon } from "../../shared/Icon";
import type { Layer } from "../../types";
import { getExportFormatPresentation } from "../../shared/exportPresentation";
import { moveExportLayer } from "./exportReviewLayers";
import {
  selectExportFormat,
  selectExportScope,
  type ExportGenerationState,
} from "./exportFormatState";
import { ExportQualitySummary } from "./ExportQualitySummary";
import { ExportReviewHeader } from "./ExportReviewHeader";
import { ExportReviewFooter } from "./ExportReviewFooter";
import { ExportReviewLayerList } from "./ExportReviewLayerList";
import { ExportReviewPreviewPanel } from "./ExportReviewPreviewPanel";
import type {
  ExportReviewProps,
  PdfScope,
  PreviewBackground,
} from "./exportReviewTypes";
import { useExportReviewDialog } from "./useExportReviewDialog";
import { useExportPreviewZoom } from "./useExportPreviewZoom";
import { useExportReviewDerivedState } from "./useExportReviewDerivedState";
import { renameExportLayer } from "./exportLayerRename";

export function ExportReview({
  mode,
  maxUploadBytes,
  layers,
  selectedLayerId,
  onSelectedLayerChange,
  onLayersChange,
  onClose,
  onNotify,
  returnFocusTo,
  canExport,
  saveState = "saved",
  onRetrySave,
  sourcePreviewUrl,
  canvasSize,
  pdfPages,
  onCreateExport,
}: ExportReviewProps) {
  const effectiveMaxUploadBytes =
    maxUploadBytes ??
    (mode === "image" ? MAX_IMAGE_UPLOAD_BYTES : MAX_PDF_UPLOAD_BYTES);
  const [background, setBackground] = useState<PreviewBackground>(mode === "image" ? "checker" : "white");
  const {
    zoom,
    fitActive,
    stageRef,
    scaleRef,
    setZoom,
    fitPreview,
  } = useExportPreviewZoom();
  const [safeBounds, setSafeBounds] = useState(true);
  const [format, setFormat] = useState<ExportFormat>("psd");
  const [pdfScope, setPdfScope] = useState<PdfScope>("pages");
  const [page, setPage] = useState(1);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [generationState, setGenerationState] = useState<ExportGenerationState>("idle");
  const [generationMessage, setGenerationMessage] = useState<string>();
  const [generationIssues, setGenerationIssues] = useState<
    readonly ProductionIssue[]
  >([]);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const {
    reviewableLayers,
    selected,
    formats,
    selectedFormat,
    displayedGenerationMessage,
    fixedBackground,
    pageCount,
    preflight,
    footerIssues,
  } = useExportReviewDerivedState(
    mode,
    layers,
    selectedLayerId,
    generationMessage,
    generationState,
    generationIssues,
    format,
    canExport,
    saveState,
    canvasSize,
    pdfPages,
  );
  const effectiveSelectedLayerId = selected?.id ?? "";
  const namingPresetId = mode === "image" ? "character-basic" : "kinetic-words";
  const orderingUnavailable = false;
  useEffect(() => { setRenameDraft(selected?.name ?? ""); setRenameError(""); }, [selected?.id, selected?.name]);

  const changeFormat = (nextFormat: ExportFormat) => {
    const next = selectExportFormat(
      { format, generationState },
      nextFormat,
    );
    setFormat(next.format);
    setGenerationState(next.generationState);
    setGenerationMessage(undefined);
    setGenerationIssues([]);
  };

  const changePdfScope = (nextScope: PdfScope) => {
    if (generationState === "working") return;
    const next = selectExportScope(
      { scope: pdfScope, generationState },
      nextScope,
    );
    setPdfScope(next.scope);
    setGenerationState(next.generationState);
    setGenerationMessage(undefined);
    setGenerationIssues([]);
  };

  const invalidateGeneratedExport = () => {
    if (generationState === "working") return;
    setGenerationState("idle");
    setGenerationMessage(undefined);
    setGenerationIssues([]);
  };

  useExportReviewDialog({
    backdropRef,
    closeButtonRef,
    dialogRef,
    isWorking: generationState === "working",
    onClose,
    returnFocusTo,
  });

  useEffect(() => {
    setFormat(mode === "image" ? "psd" : "png-layers-json");
    setGenerationState("idle");
    setGenerationMessage(undefined);
    setGenerationIssues([]);
    setBackground(mode === "image" ? "checker" : "white");
  }, [mode]);

  const updateLayer = (id: string, changes: Partial<Layer>) => {
    const target = layers.find((layer) => layer.id === id);
    if (!target || target.kind === "group" || target.fixed) return;
    invalidateGeneratedExport();
    onLayersChange(layers.map((layer) => (layer.id === id ? { ...layer, ...changes } : layer)));
  };

  const commitLayerName = () => {
    const result = renameExportLayer(layers, selected, renameDraft, fixedBackground);
    if (result === null) return;
    if (result === false) {
      setRenameError("الاسم مستخدم داخل المجلد نفسه.");
      return;
    }
    const [name, renamedLayers] = result;
    setRenameDraft(name);
    setRenameError("");
    if (selected && name !== selected.name) {
      invalidateGeneratedExport();
      onLayersChange(renamedLayers);
    }
  };

  const moveLayer = (direction: -1 | 1) => {
    if (!selected || fixedBackground) return;
    const result = moveExportLayer(
      layers,
      reviewableLayers,
      selected.id,
      direction,
    );
    if (!result) return;
    invalidateGeneratedExport();
    onLayersChange(result.layers);
  };

  const createExport = async () => {
    if (!selectedFormat) {
      const message = "محول الصيغة المختارة غير متاح بعد، ولم تُنشأ مهمة عالقة.";
      setGenerationMessage(message);
      onNotify(message);
      return;
    }
    if (!canExport) {
      const message = "ارفع مصدرًا حقيقيًا أولًا قبل إنشاء ملف التصدير.";
      setGenerationMessage(message);
      onNotify(message);
      return;
    }
    if (
      saveState === "saving" ||
      saveState === "conflict" ||
      saveState === "error" ||
      saveState === "unavailable"
    ) {
      const message =
        saveState === "saving"
          ? "انتظر اكتمال حفظ مراجعة الطبقات قبل التصدير."
          : saveState === "conflict"
            ? "توجد نسخة أحدث من المشروع. أعد تحميلها قبل التصدير."
            : saveState === "unavailable"
              ? "ارفع مصدرًا وجهّزه قبل التصدير."
              : "تعذر حفظ مراجعة الطبقات. أعد الحفظ قبل التصدير.";
      setGenerationMessage(message);
      onNotify(message);
      return;
    }
    setGenerationMessage(undefined);
    setGenerationIssues([]);
    setGenerationState("working");
    try {
      await onCreateExport(
        format,
        {
          scale: 1,
          colorProfile: "sRGB",
          namingPresetId,
          ...(mode === "book" && format === "psd"
            ? pdfScope === "document"
              ? { scope: "full-document" as const }
              : pdfScope === "pages"
                ? { scope: "per-page" as const }
                : {
                    scope: "selected-page" as const,
                    selectedPage: page,
                  }
            : {}),
        },
      );
      setGenerationState("done");
      const successMessage = getExportFormatPresentation(
        format,
        mode,
      ).successMessage;
      setGenerationMessage(successMessage);
      onNotify(successMessage);
    } catch (error) {
      setGenerationState("idle");
      setGenerationIssues(error instanceof ApiError ? error.issues : []);
      const message =
        error instanceof Error ? error.message : "تعذر إنشاء ملف التصدير.";
      setGenerationMessage(message);
      onNotify(message);
    }
  };

  return (
    <div ref={backdropRef} className="export-review-backdrop">
      <section
        ref={dialogRef}
        className="export-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-review-title"
        tabIndex={-1}
      >
        <ExportReviewHeader
          closeButtonRef={closeButtonRef}
          format={format}
          isWorking={generationState === "working"}
          preflightStatus={preflight.status}
          onClose={onClose}
        />

        <div className="export-review__body">
          <ExportReviewPreviewPanel
            mode={mode}
            background={background}
            zoom={zoom}
            fitActive={fitActive}
            stageRef={stageRef}
            scaleRef={scaleRef}
            setZoom={setZoom}
            fitPreview={fitPreview}
            setBackground={setBackground}
            safeBounds={safeBounds}
            setSafeBounds={setSafeBounds}
            layers={reviewableLayers}
            selectedLayerId={effectiveSelectedLayerId}
            canvasSize={canvasSize}
            sourcePreviewUrl={sourcePreviewUrl}
            page={page}
            pdfPages={pdfPages}
            pageCount={pageCount}
            pdfScope={pdfScope}
            generationState={generationState}
            invalidateGeneratedExport={invalidateGeneratedExport}
            setPage={setPage}
            format={format}
          />

          <aside className="export-layer-review" aria-label="مراجعة الطبقات">
            <div className="review-section-heading">
              <div><strong>الطبقات</strong><small>{mode === "image" ? `${reviewableLayers.length} / ${MAX_IMAGE_LAYERS} طبقة` : `${reviewableLayers.length} طبقات فعلية في ${pageCount} صفحة`}</small></div>
              <span className={mode === "image" ? "review-count" : "review-count is-unlimited"}>
                {mode === "image" ? `${reviewableLayers.length}/15` : "بلا حد"}
              </span>
            </div>

            <ExportReviewLayerList
              layers={reviewableLayers}
              selectedLayerId={effectiveSelectedLayerId}
              onSelect={onSelectedLayerChange}
            />

            {selected && (
              <div className="selected-layer-editor">
                <label className="rename-field">
                  <span>اسم الطبقة</span>
                  <input
                    value={renameDraft}
                    onChange={(event) => {
                      setRenameDraft(event.target.value);
                      setRenameError("");
                    }}
                    onBlur={commitLayerName}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitLayerName();
                      }
                      if (event.key === "Escape") {
                        setRenameDraft(selected.name);
                        setRenameError("");
                      }
                    }}
                    disabled={fixedBackground || generationState === "working"}
                    aria-invalid={Boolean(renameError)}
                    aria-describedby={fixedBackground ? "fixed-background-note" : renameError ? "export-rename-error" : undefined}
                  />
                  {renameError && <small id="export-rename-error" role="alert">{renameError}</small>}
                </label>
                {fixedBackground && <p id="fixed-background-note" className="fixed-layer-note"><Icon name="lock" size={13} /> الخلفية البيضاء ثابتة؛ لا يمكن إعادة تسميتها أو فتحها أو حذفها.</p>}
                <div className="layer-quick-actions">
                  <button type="button" onClick={() => updateLayer(selected.id, { visible: !selected.visible })} disabled={fixedBackground || generationState === "working"}>
                    <Icon name={selected.visible ? "eye" : "eyeOff"} size={15} /> {selected.visible ? "ظاهرة" : "مخفية"}
                  </button>
                  <button type="button" onClick={() => !fixedBackground && updateLayer(selected.id, { locked: !selected.locked })} disabled={fixedBackground || generationState === "working"}>
                    <Icon name={selected.locked ? "lock" : "unlock"} size={15} /> {selected.locked ? "مقفلة" : "مفتوحة"}
                  </button>
                  <button
                    type="button"
                    onClick={() => moveLayer(-1)}
                    disabled={fixedBackground || orderingUnavailable || generationState === "working"}
                    title={orderingUnavailable ? "تعذر حفظ ترتيب الطبقات" : "يحفظ الترتيب تلقائيًا في وثيقة الطبقات"}
                    aria-label="تحريك الطبقة لأعلى"
                  >
                    <Icon name="arrowUp" size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveLayer(1)}
                    disabled={fixedBackground || orderingUnavailable || generationState === "working"}
                    title={orderingUnavailable ? "تعذر حفظ ترتيب الطبقات" : "يحفظ الترتيب تلقائيًا في وثيقة الطبقات"}
                    aria-label="تحريك الطبقة لأسفل"
                  >
                    <Icon name="arrowDown" size={15} />
                  </button>
                </div>
                <label className="opacity-field">
                  <span>الشفافية <b>{selected.opacity}%</b></span>
                  <input type="range" min="0" max="100" value={selected.opacity} disabled={fixedBackground || generationState === "working"} onChange={(event) => updateLayer(selected.id, { opacity: Number(event.target.value) })} />
                </label>
              </div>
            )}
          </aside>

          <aside className="export-setup-panel" aria-label="إعداد التصدير">
            <div className="export-setup-scroll">
              <ExportQualitySummary mode={mode} maxUploadBytes={effectiveMaxUploadBytes} preflight={preflight} />

            <div className="export-setup">
              <div className="review-section-heading"><div><strong>إعداد التصدير</strong><small>الخيارات الأساسية فقط</small></div></div>
              <fieldset className="format-options">
                <legend>الصيغة</legend>
                {formats.map((item) => (
                  <label key={item.id} className={format === item.id ? "is-selected" : ""}>
                    <input type="radio" name="export-format" value={item.id} checked={format === item.id} onChange={() => changeFormat(item.id)} disabled={generationState === "working"} />
                    <span><strong>{item.title}</strong><small>{item.hint}</small></span>
                  </label>
                ))}
              </fieldset>

              {mode === "book" && format === "psd" && (
                <fieldset className="scope-options">
                  <legend>نطاق الإخراج</legend>
                  <label className={pdfScope === "document" ? "is-selected" : ""}><input type="radio" checked={pdfScope === "document"} onChange={() => changePdfScope("document")} disabled={generationState === "working"} /><span><strong>PSD واحد للمستند</strong><small>كل الصفحات في ملف واحد</small></span></label>
                  <label className={pdfScope === "pages" ? "is-selected" : ""}><input type="radio" checked={pdfScope === "pages"} onChange={() => changePdfScope("pages")} disabled={generationState === "working"} /><span><strong>PSD لكل صفحة</strong><small>موصى به للأداء وسهولة التحريك</small></span></label>
                  <label className={pdfScope === "selected" ? "is-selected" : ""}><input type="radio" checked={pdfScope === "selected"} onChange={() => changePdfScope("selected")} disabled={generationState === "working"} /><span><strong>الصفحة الحالية فقط</strong><small>الصفحة {page} من {pageCount}</small></span></label>
                </fieldset>
              )}

              <div className="export-fields">
                <div><span>الدقة الفعلية</span><output>الحجم الأصلي · 1×</output></div>
                <div><span>ملف الألوان</span><output>sRGB IEC61966-2.1</output></div>
                <div><span>قالب الوثيقة</span><output>{namingPresetId}</output></div>
              </div>

              <button className="advanced-export-toggle" type="button" onClick={() => setAdvancedOpen((value) => !value)} aria-expanded={advancedOpen}>
                <Icon name="filter" size={15} /> خيارات متقدمة <Icon name="chevron" size={14} />
              </button>
              {advancedOpen && (
                <div className="advanced-export-options">
                  <span><Icon name="check" size={13} /> تُحفظ بيانات الموضع داخل الملف أو manifest بحسب الصيغة.</span>
                  <span><Icon name="check" size={13} /> تُنشئ الصيغ الحزمية manifest تلقائيًا ولا تعرض خيارًا وهميًا لتعطيله.</span>
                </div>
              )}
            </div>

              <div className="export-estimate">
                <div><span>الحجم</span><strong>يُحسب بعد الإنشاء</strong></div>
                <div><span>الوقت</span><strong>حسب حجم المصدر</strong></div>
              </div>

              <div className="local-demo-note"><Icon name="info" size={14} /><span>للصور: PSD وTIFF وPNG الشفافة وPNG + JSON. ولـPDF: PSD وPNG + JSON وTXT/CSV/JSON؛ وتُرسم نصوص PSD كطبقات Raster لتجنب اختلاف الخطوط بين الأجهزة.</span></div>
              {saveState !== "saved" && (
                <div className={`export-save-state is-${saveState}`} role="status">
                  <span>
                    {saveState === "error"
                      ? "لم تُحفظ مراجعة الطبقات الأخيرة."
                      : saveState === "conflict"
                        ? "توجد نسخة أحدث. أعد تحميل المشروع لحماية تعديلاتك."
                        : saveState === "saving"
                          ? "جارٍ حفظ مراجعة الطبقات…"
                          : saveState === "unavailable"
                            ? "الحفظ غير متاح قبل تجهيز المصدر."
                            : "توجد تغييرات تنتظر الحفظ، وستُحفظ قبل إنشاء الملف."}
                  </span>
                  {saveState === "error" && onRetrySave && (
                    <button
                      type="button"
                      onClick={() => {
                        void onRetrySave().catch((error: unknown) => {
                          const message =
                            error instanceof Error
                              ? error.message
                              : "تعذر إعادة الحفظ.";
                          setGenerationMessage(message);
                        });
                      }}
                    >
                      إعادة الحفظ
                    </button>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>
        <ExportReviewFooter
          generationState={generationState}
          disabled={
            generationState === "working" ||
            !selectedFormat ||
            preflight.status === "blocked"
          }
          onCreate={() => void createExport()}
          message={displayedGenerationMessage}
          issues={footerIssues}
        />
      </section>
    </div>
  );
}
