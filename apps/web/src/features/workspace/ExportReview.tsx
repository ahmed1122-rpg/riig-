import { useEffect, useMemo, useRef, useState } from "react";
import {
  exportFormatsByProjectKind,
  MAX_IMAGE_LAYERS,
  MAX_UPLOAD_BYTES,
  type ExportFormat,
} from "@motionprep/contracts";
import { Icon } from "../../shared/Icon";
import type { Layer, ProjectMode } from "../../types";
import { getExportFormatPresentation } from "../exports/exportPresentation";
import { moveEditableLayer } from "./layerReviewState";
import {
  selectExportFormat,
  selectExportScope,
  type ExportGenerationState,
} from "./exportFormatState";
import { ExportQualitySummary } from "./ExportQualitySummary";
import {
  ExportCharacterPreview,
  ExportPdfPreview,
} from "./ExportReviewPreviews";
import { ExportReviewHeader } from "./ExportReviewHeader";
import { useExportReviewDialog } from "./useExportReviewDialog";

export { ExportCharacterPreview, ExportPdfPreview } from "./ExportReviewPreviews";

type PreviewBackground = "white" | "transparent" | "checker";
type PdfScope = "document" | "pages" | "selected";

interface ExportReviewProps {
  mode: ProjectMode;
  maxUploadBytes?: number;
  layers: Layer[];
  selectedLayerId: string;
  onSelectedLayerChange: (id: string) => void;
  onLayersChange: (layers: Layer[]) => void;
  onClose: () => void;
  onNotify: (message: string) => void;
  returnFocusTo: HTMLElement | null;
  canExport: boolean;
  saveState?: "idle" | "saving" | "saved" | "error";
  onRetrySave?: () => Promise<void>;
  sourcePreviewUrl?: string;
  canvasSize?: {
    width: number;
    height: number;
  };
  pdfPages?: Array<{
    pageNumber: number;
    width: number;
    height: number;
  }>;
  onCreateExport: (
    format: ExportFormat,
    options: {
      scope?: "full-document" | "per-page" | "selected-page";
      selectedPage?: number;
      scale: 1;
      colorProfile: "sRGB";
      namingPresetId: string;
    },
  ) => Promise<void>;
}

type FormatOption = { id: ExportFormat; title: string; hint: string };

export function ExportReview({
  mode,
  maxUploadBytes = MAX_UPLOAD_BYTES,
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
  const [background, setBackground] = useState<PreviewBackground>(mode === "image" ? "checker" : "white");
  const [zoom, setZoom] = useState(78);
  const [safeBounds, setSafeBounds] = useState(true);
  const [format, setFormat] = useState<ExportFormat>("psd");
  const [pdfScope, setPdfScope] = useState<PdfScope>("pages");
  const [page, setPage] = useState(1);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [generationState, setGenerationState] = useState<ExportGenerationState>("idle");
  const [generationMessage, setGenerationMessage] = useState<string>();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(
    () => layers.find((layer) => layer.id === selectedLayerId) ?? layers[0],
    [layers, selectedLayerId],
  );
  const formats = useMemo<FormatOption[]>(
    () =>
      exportFormatsByProjectKind[mode].map((id) => {
        const presentation = getExportFormatPresentation(id, mode);
        return { id, title: presentation.label, hint: presentation.hint };
      }),
    [mode],
  );
  const selectedFormat = formats.find((item) => item.id === format);
  const namingPresetId = mode === "image" ? "character-basic" : "kinetic-words";
  const displayedGenerationMessage =
    generationMessage ??
    (generationState === "done"
      ? getExportFormatPresentation(format, mode).successMessage
      : undefined);
  const fixedBackground = mode === "book" && selected?.kind === "page";
  const structuralEditingUnavailable = canExport;
  const orderingUnavailable = false;
  const pageCount = Math.max(
    1,
    ...layers.map((layer) => layer.pageNumber ?? 1),
  );

  const changeFormat = (nextFormat: ExportFormat) => {
    const next = selectExportFormat(
      { format, generationState },
      nextFormat,
    );
    setFormat(next.format);
    setGenerationState(next.generationState);
    setGenerationMessage(undefined);
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
  };

  const invalidateGeneratedExport = () => {
    if (generationState === "working") return;
    setGenerationState("idle");
    setGenerationMessage(undefined);
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
    setBackground(mode === "image" ? "checker" : "white");
  }, [mode]);

  const updateLayer = (id: string, changes: Partial<Layer>) => {
    invalidateGeneratedExport();
    onLayersChange(layers.map((layer) => (layer.id === id ? { ...layer, ...changes } : layer)));
  };

  const renameLayer = (value: string) => {
    if (!selected || fixedBackground) return;
    const withoutPrefix = value.replace(/^\++/, "");
    updateLayer(selected.id, { name: `+${withoutPrefix}` });
  };

  const settleLayerName = () => {
    if (!selected || fixedBackground || selected.name !== "+") return;
    updateLayer(selected.id, { name: `+طبقة_${layers.indexOf(selected) + 1}` });
  };

  const moveLayer = (direction: -1 | 1) => {
    if (!selected || fixedBackground) return;
    const from = layers.findIndex((layer) => layer.id === selected.id);
    const result = moveEditableLayer(layers, selected.id, from + direction);
    if (!result) return;
    invalidateGeneratedExport();
    onLayersChange(result.layers);
  };

  const mergeSelected = () => {
    if (!selected || fixedBackground) return;
    const target = layers.find((layer) => layer.id !== selected.id && layer.kind !== "page");
    if (!target) return;
    invalidateGeneratedExport();
    onLayersChange(layers.filter((layer) => layer.id !== selected.id));
    onSelectedLayerChange(target.id);
    onNotify("تم دمج الطبقة داخل نسخة المراجعة.");
  };

  const splitSelected = () => {
    if (!selected || fixedBackground) return;
    if (mode === "image" && layers.length >= MAX_IMAGE_LAYERS) {
      onNotify(
        `لا يمكن إضافة طبقة: الحد الأقصى للصور ${MAX_IMAGE_LAYERS} طبقة.`,
      );
      return;
    }
    const newLayer: Layer = {
      ...selected,
      id: `${selected.id}-split-${Date.now()}`,
      name: `${selected.name.replace(/^\++/, "+")}_جزء`,
      locked: false,
    };
    const index = layers.findIndex((layer) => layer.id === selected.id);
    const next = [...layers];
    next.splice(index + 1, 0, newLayer);
    invalidateGeneratedExport();
    onLayersChange(next);
    onSelectedLayerChange(newLayer.id);
    onNotify("تم إنشاء جزء جديد للمراجعة قبل التصدير.");
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
    if (saveState === "saving" || saveState === "error") {
      const message =
        saveState === "saving"
          ? "انتظر اكتمال حفظ مراجعة الطبقات قبل التصدير."
          : "تعذر حفظ مراجعة الطبقات. أعد الحفظ قبل التصدير.";
      setGenerationMessage(message);
      onNotify(message);
      return;
    }
    setGenerationMessage(undefined);
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
          onClose={onClose}
        />

        <div className="export-review__body">
          <section className="export-preview-panel" aria-label="المعاينة النهائية">
            <div className="export-preview-toolbar">
              <div className="preview-group" aria-label="تكبير المعاينة">
                <button type="button" onClick={() => setZoom((value) => Math.max(30, value - 10))} aria-label="تصغير"><Icon name="zoomOut" size={16} /></button>
                <button type="button" className="zoom-value" onClick={() => setZoom(100)} aria-label="عرض مئة بالمئة">{zoom}%</button>
                <button type="button" onClick={() => setZoom((value) => Math.min(160, value + 10))} aria-label="تكبير"><Icon name="zoomIn" size={16} /></button>
                <button type="button" onClick={() => setZoom(78)}>ملاءمة</button>
                <button type="button" onClick={() => setZoom(100)}>100%</button>
              </div>
              <div className="preview-group background-switch" role="radiogroup" aria-label="خلفية المعاينة">
                <button type="button" className={background === "white" ? "is-active" : ""} onClick={() => setBackground("white")} aria-pressed={background === "white"}>بيضاء</button>
                {mode === "image" && (
                  <>
                    <button type="button" className={background === "transparent" ? "is-active" : ""} onClick={() => setBackground("transparent")} aria-pressed={background === "transparent"}>شفافة</button>
                    <button type="button" className={background === "checker" ? "is-active" : ""} onClick={() => setBackground("checker")} aria-pressed={background === "checker"}>شبكية</button>
                  </>
                )}
              </div>
              <button className={safeBounds ? "safe-toggle is-active" : "safe-toggle"} type="button" onClick={() => setSafeBounds((value) => !value)} aria-pressed={safeBounds}>
                <Icon name="scan" size={15} /> حدود الأمان
              </button>
            </div>

            <div className={`export-preview-stage preview-bg--${background}`}>
              <div className="export-preview-scale" style={{ "--review-zoom": zoom / 100 } as React.CSSProperties}>
                {mode === "image" ? (
                  <ExportCharacterPreview
                    layers={layers}
                    selectedLayerId={selectedLayerId}
                    safeBounds={safeBounds}
                    canvasWidth={canvasSize?.width ?? 1}
                    canvasHeight={canvasSize?.height ?? 1}
                    {...(sourcePreviewUrl ? { sourcePreviewUrl } : {})}
                  />
                ) : (
                  <ExportPdfPreview
                    layers={layers}
                    selectedLayerId={selectedLayerId}
                    safeBounds={safeBounds}
                    page={page}
                    {...(pdfPages ? { pages: pdfPages } : {})}
                  />
                )}
              </div>
              {mode === "book" && (
                <div className="pdf-page-navigation">
                  <button type="button" onClick={() => { if (pdfScope === "selected") invalidateGeneratedExport(); setPage((value) => Math.max(1, value - 1)); }} disabled={page === 1 || (generationState === "working" && pdfScope === "selected")} aria-label="الصفحة السابقة"><Icon name="chevron" size={16} /></button>
                  <span>صفحة <b>{page}</b> من {pageCount}</span>
                  <button type="button" onClick={() => { if (pdfScope === "selected") invalidateGeneratedExport(); setPage((value) => Math.min(pageCount, value + 1)); }} disabled={page === pageCount || (generationState === "working" && pdfScope === "selected")} aria-label="الصفحة التالية"><Icon name="chevron" size={16} /></button>
                </div>
              )}
              <span className="adobe-proof"><b>{format === "psd" ? "PSD" : format === "txt" || format === "csv" || format === "json" ? format.toUpperCase() : "ZIP"}</b> <span>أسماء + محفوظة · sRGB</span></span>
            </div>
          </section>

          <aside className="export-layer-review" aria-label="مراجعة الطبقات">
            <div className="review-section-heading">
              <div><strong>الطبقات</strong><small>{mode === "image" ? `${layers.length} / ${MAX_IMAGE_LAYERS} طبقة` : `${layers.length} طبقات فعلية في ${pageCount} صفحة`}</small></div>
              <span className={mode === "image" ? "review-count" : "review-count is-unlimited"}>
                {mode === "image" ? `${layers.length}/15` : "بلا حد"}
              </span>
            </div>

            <div className="export-layer-list">
              {layers.map((layer) => (
                <button
                  key={layer.id}
                  className={`export-layer-item ${layer.id === selectedLayerId ? "is-selected" : ""} ${layer.kind === "page" ? "is-fixed" : ""}`}
                  type="button"
                  onClick={() => onSelectedLayerChange(layer.id)}
                >
                  <Icon name="grip" size={15} />
                  <span className="layer-swatch" style={{ "--layer-color": layer.color } as React.CSSProperties}>{layer.kind === "text" ? "ن" : ""}</span>
                  <span><strong dir={/^[A-Za-z0-9]/.test(layer.name.slice(1)) ? "ltr" : "rtl"}>{layer.name}</strong><small>{layer.kind === "page" ? "خلفية بيضاء ثابتة" : `${layer.opacity}% · ${layer.visible ? "ظاهرة" : "مخفية"}`}</small></span>
                  {layer.kind === "page" && <Icon name="lock" size={14} />}
                </button>
              ))}
            </div>

            {selected && (
              <div className="selected-layer-editor">
                <label className="rename-field">
                  <span>اسم الطبقة</span>
                  <input
                    value={selected.name}
                    onChange={(event) => renameLayer(event.target.value)}
                    onBlur={settleLayerName}
                    disabled={fixedBackground || generationState === "working"}
                    aria-describedby={fixedBackground ? "fixed-background-note" : undefined}
                  />
                </label>
                {fixedBackground && <p id="fixed-background-note" className="fixed-layer-note"><Icon name="lock" size={13} /> الخلفية البيضاء ثابتة؛ لا يمكن إعادة تسميتها أو فتحها أو حذفها.</p>}
                <div className="layer-quick-actions">
                  <button type="button" onClick={() => updateLayer(selected.id, { visible: !selected.visible })} disabled={generationState === "working"}>
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
                {!structuralEditingUnavailable && (
                  <div className="merge-split-actions">
                    <button type="button" onClick={mergeSelected} disabled={fixedBackground}><Icon name="merge" size={15} /> دمج</button>
                    <button type="button" onClick={splitSelected} disabled={fixedBackground}><Icon name="split" size={15} /> فصل</button>
                  </div>
                )}
              </div>
            )}
          </aside>

          <aside className="export-setup-panel" aria-label="إعداد التصدير">
            <div className="export-setup-scroll">
              <ExportQualitySummary mode={mode} imageLayerCount={layers.length} maxUploadBytes={maxUploadBytes} />

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
                      : saveState === "saving"
                        ? "جارٍ حفظ مراجعة الطبقات…"
                        : "توجد تغييرات تنتظر الحفظ."}
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
        <footer className="export-action-footer">
          <button className={`create-export-button ${generationState === "done" ? "is-done" : ""}`} type="button" onClick={() => void createExport()} disabled={generationState === "working" || !selectedFormat || !canExport || saveState === "saving" || saveState === "error"}>
            <Icon name={generationState === "done" ? "check" : "download"} size={17} />
            {generationState === "working" ? "جارٍ تجهيز النسخة…" : generationState === "done" ? "تم إنشاء الملف" : "إنشاء ملف التصدير"}
          </button>
          {displayedGenerationMessage && (
            <p
              className={`export-generation-message ${generationState === "done" ? "is-success" : "is-error"}`}
              role="status"
              aria-live="polite"
            >
              {displayedGenerationMessage}
            </p>
          )}
        </footer>
      </section>
    </div>
  );
}
