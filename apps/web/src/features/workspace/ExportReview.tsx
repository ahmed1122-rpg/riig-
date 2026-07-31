import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../shared/Icon";
import type { Layer, ProjectMode } from "../../types";
import { reindexLayerOrder } from "./layerReviewState";
import {
  selectExportFormat,
  selectExportScope,
  type ExportGenerationState,
} from "./exportFormatState";
import { RasterLayerPreview } from "./RasterLayerPreview";

type PreviewBackground = "white" | "transparent" | "checker";
type ImageFormat = "psd" | "tiff" | "png-zip" | "png-files";
type PdfFormat = "psd" | "png-zip" | "txt" | "csv" | "json";
type ExportFormat = ImageFormat | PdfFormat;
type PdfScope = "document" | "pages" | "selected";

interface ExportReviewProps {
  mode: ProjectMode;
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
    format: "psd" | "tiff" | "png-zip" | "png-files" | "txt" | "csv" | "json",
    options?: {
      scope?: "full-document" | "per-page" | "selected-page";
      selectedPage?: number;
    },
  ) => Promise<void>;
}

interface FormatOption<T extends ExportFormat> {
  id: T;
  title: string;
  hint: string;
  available: boolean;
}

const imageFormats: FormatOption<ImageFormat>[] = [
  { id: "psd", title: "PSD بطبقات", hint: "RGB/8-bit مع طبقات Raster", available: true },
  { id: "png-zip", title: "PNG + JSON", hint: "المصدر وManifest داخل ZIP", available: true },
  { id: "tiff", title: "TIFF متعدد الصفحات", hint: "صفحة كاملة المساحة لكل طبقة Raster", available: true },
  { id: "png-files", title: "PNG شفافة", hint: "PNG كاملة المساحة لكل طبقة", available: true },
];

const pdfFormats: FormatOption<PdfFormat>[] = [
  { id: "psd", title: "PSD بطبقات", hint: "طبقات نص Raster مستقلة وخلفية بيضاء ثابتة", available: true },
  { id: "png-zip", title: "PNG + JSON", hint: "المصدر والخلفيات والمواضع", available: true },
  { id: "txt", title: "TXT", hint: "النص المستخرج", available: true },
  { id: "csv", title: "CSV", hint: "الوحدات والمواضع", available: true },
  { id: "json", title: "JSON", hint: "وثيقة الطبقات الكاملة", available: true },
];

function exportSuccessMessage(format: ExportFormat): string {
  switch (format) {
    case "psd":
      return "تم إنشاء ملف PSD وتنزيله.";
    case "png-zip":
      return "تم إنشاء حزمة PNG + JSON وتنزيلها.";
    case "png-files":
      return "تم إنشاء حزمة PNG الشفافة وتنزيلها.";
    case "tiff":
      return "تم إنشاء ملف TIFF متعدد الصفحات وتنزيله.";
    case "txt":
      return "تم إنشاء ملف TXT وتنزيله.";
    case "csv":
      return "تم إنشاء ملف CSV وتنزيله.";
    case "json":
      return "تم إنشاء ملف JSON وتنزيله.";
  }
}

export function ExportReview({
  mode,
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
  const onCloseRef = useRef(onClose);
  const generationStateRef = useRef(generationState);
  const generationTimerRef = useRef<number | null>(null);
  onCloseRef.current = onClose;
  generationStateRef.current = generationState;
  const selected = useMemo(
    () => layers.find((layer) => layer.id === selectedLayerId) ?? layers[0],
    [layers, selectedLayerId],
  );
  const formats = mode === "image" ? imageFormats : pdfFormats;
  const selectedFormat = formats.find((item) => item.id === format);
  const displayedGenerationMessage =
    generationMessage ??
    (generationState === "done" ? exportSuccessMessage(format) : undefined);
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

  useEffect(() => {
    const restoreFocusTo = returnFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const backdrop = backdropRef.current;
    const dialog = dialogRef.current;
    const isolatedElements: {
      element: HTMLElement;
      hadInert: boolean;
      ariaHidden: string | null;
    }[] = [];

    // Isolate every sibling outside the modal path, including the app shell.
    let modalBranch: HTMLElement | null = backdrop;
    while (modalBranch?.parentElement) {
      const parent = modalBranch.parentElement;
      Array.from(parent.children).forEach((child) => {
        if (child === modalBranch || !(child instanceof HTMLElement)) return;
        isolatedElements.push({
          element: child,
          hadInert: child.hasAttribute("inert"),
          ariaHidden: child.getAttribute("aria-hidden"),
        });
        child.setAttribute("inert", "");
        child.setAttribute("aria-hidden", "true");
      });
      if (parent === document.body) break;
      modalBranch = parent;
    }

    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && generationStateRef.current !== "working") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (generationTimerRef.current !== null) window.clearTimeout(generationTimerRef.current);
      isolatedElements.forEach(({ element, hadInert, ariaHidden }) => {
        if (!hadInert) element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      window.requestAnimationFrame(() => restoreFocusTo?.focus());
    };
  }, [returnFocusTo]);

  useEffect(() => {
    setFormat(mode === "image" ? "psd" : "png-zip");
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
    const to = Math.max(0, Math.min(layers.length - 1, from + direction));
    if (from === to || layers[to]?.kind === "page") return;
    const next = [...layers];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    invalidateGeneratedExport();
    onLayersChange(reindexLayerOrder(next));
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
    if (mode === "image" && layers.length >= 15) {
      onNotify("لا يمكن إضافة طبقة: الحد الأقصى للصور 15 طبقة.");
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
    if (!selectedFormat?.available) {
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
        format as "psd" | "tiff" | "png-zip" | "png-files" | "txt" | "csv" | "json",
        mode === "book" && format === "psd"
          ? pdfScope === "document"
            ? { scope: "full-document" }
            : pdfScope === "pages"
              ? { scope: "per-page" }
              : { scope: "selected-page", selectedPage: page }
          : undefined,
      );
      setGenerationState("done");
      const successMessage = exportSuccessMessage(format);
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
        <header className="export-review__header">
          <div className="export-review__title">
            <button ref={closeButtonRef} className="icon-button" type="button" onClick={onClose} disabled={generationState === "working"} aria-label="إغلاق مراجعة التصدير">
              <Icon name="close" size={19} />
            </button>
            <span className="export-proof-mark"><Icon name="packageCheck" size={20} /></span>
            <div>
              <h2 id="export-review-title">المراجعة النهائية</h2>
              <p>عاين الطبقات والأسماء وهدف Adobe قبل إنشاء الملف.</p>
            </div>
          </div>
          <div className="export-review__status">
            <span className="ready-pill"><Icon name="check" size={14} /> جاهز للتصدير</span>
            <span className="review-file-name" dir="ltr">
              {format === "psd" ? "motionprep.psd" : format === "txt" || format === "csv" || format === "json" ? `motionprep.${format}` : "motionprep.zip"}
            </span>
          </div>
        </header>

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
                    pages={pdfPages}
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
              <div><strong>الطبقات</strong><small>{mode === "image" ? `${layers.length} / 15 طبقة` : `${layers.length} طبقات فعلية في ${pageCount} صفحة`}</small></div>
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
            <QualitySummary mode={mode} imageLayerCount={layers.length} />

            <div className="export-setup">
              <div className="review-section-heading"><div><strong>إعداد التصدير</strong><small>الخيارات الأساسية فقط</small></div></div>
              <fieldset className="format-options">
                <legend>الصيغة</legend>
                {formats.map((item) => (
                  <label key={item.id} className={`${format === item.id ? "is-selected" : ""} ${item.available ? "" : "is-disabled"}`.trim()}>
                    <input type="radio" name="export-format" value={item.id} checked={format === item.id} onChange={() => changeFormat(item.id)} disabled={!item.available || generationState === "working"} />
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
                <label><span>الدقة</span><select defaultValue="original" disabled><option value="original">الحجم الأصلي</option></select></label>
                <label><span>ملف الألوان</span><select defaultValue="srgb" disabled><option value="srgb">sRGB IEC61966-2.1</option></select></label>
                <label><span>قالب التسمية</span><select defaultValue="adobe" disabled><option value="adobe">أسماء + الحالية</option></select></label>
              </div>

              <button className="advanced-export-toggle" type="button" onClick={() => setAdvancedOpen((value) => !value)} aria-expanded={advancedOpen}>
                <Icon name="filter" size={15} /> خيارات متقدمة <Icon name="chevron" size={14} />
              </button>
              {advancedOpen && (
                <div className="advanced-export-options">
                  <label><input type="checkbox" defaultChecked /> تضمين ملف manifest</label>
                  <label><input type="checkbox" defaultChecked /> الاحتفاظ ببيانات الموضع</label>
                </div>
              )}
            </div>

            <div className="export-estimate">
              <div><span>الحجم</span><strong>يُحسب بعد الإنشاء</strong></div>
              <div><span>الوقت</span><strong>حسب حجم المصدر</strong></div>
            </div>

            <div className="local-demo-note"><Icon name="info" size={14} /><span>PSD للصور وPDF وPNG الشفافة وPNG + JSON والمخرجات النصية تعمل فعليًا. PDF ينتج نصوصًا Raster مستقلة لتجنب اختلاف الخطوط بين الأجهزة.</span></div>
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
            <button className={`create-export-button ${generationState === "done" ? "is-done" : ""}`} type="button" onClick={() => void createExport()} disabled={generationState === "working" || !selectedFormat?.available || !canExport || saveState === "saving" || saveState === "error"}>
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
          </aside>
        </div>
      </section>
    </div>
  );
}

function QualitySummary({ mode, imageLayerCount }: { mode: ProjectMode; imageLayerCount: number }) {
  return (
    <section className="quality-summary">
      <div className="quality-summary__heading">
        <span><Icon name="packageCheck" size={18} /></span>
        <div><strong>فحص ما قبل التصدير</strong><small>يعيد الخادم التحقق من الوثيقة قبل الإنشاء</small></div>
      </div>
      <ul>
        <li className="is-ok"><Icon name="check" size={14} /><span>أسماء الطبقات تبدأ بـ + واحدة</span></li>
        {mode === "image" ? (
          <li className={imageLayerCount <= 15 ? "is-ok" : "is-blocker"}><Icon name={imageLayerCount <= 15 ? "check" : "warning"} size={14} /><span>{imageLayerCount} / 15 طبقة للصور</span></li>
        ) : (
          <>
            <li className="is-ok"><Icon name="check" size={14} /><span>الخلفية البيضاء الثابتة مطلوبة لكل صفحة</span></li>
            <li className="is-unlimited"><Icon name="info" size={14} /><span>حد المصدر 30 MB · لا يوجد حد ثابت لعدد طبقات PDF</span></li>
          </>
        )}
            <li className="is-warning"><Icon name="warning" size={14} /><span>{mode === "image" ? "PSD حقيقي، لكن ادعاء توافق Adobe الكامل مؤجل لاختبارات Golden" : "PSD فعلي بطبقات Raster؛ النصوص قابلة للتحريك كطبقات وليست قابلة للتحرير كنص داخل Photoshop"}</span></li>
      </ul>
    </section>
  );
}

export function ExportCharacterPreview({
  layers,
  selectedLayerId,
  safeBounds,
  sourcePreviewUrl,
  canvasWidth = 1,
  canvasHeight = 1,
}: {
  layers: Layer[];
  selectedLayerId: string;
  safeBounds: boolean;
  sourcePreviewUrl?: string;
  canvasWidth?: number;
  canvasHeight?: number;
}) {
  const visible = (id: string) => layers.find((layer) => layer.id === id)?.visible !== false;
  const hasRealPreview =
    Boolean(sourcePreviewUrl) || layers.some((layer) => layer.previewUrl);
  return (
    <div className={`export-image-board ${hasRealPreview ? "has-source" : ""} ${safeBounds ? "show-safe-bounds" : ""}`}>
      <div className="artboard-grid" />
      {hasRealPreview ? (
        <RasterLayerPreview
          layers={layers}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          selectedLayerId={selectedLayerId}
          fallbackSourceUrl={sourcePreviewUrl}
          label="معاينة المصدر الحقيقي قبل التصدير"
          className="export-source-image"
        />
      ) : (
        <div className="character" aria-label="معاينة إرشادية للشخصية قبل رفع المصدر">
          {visible("legs") && <span className={`character-legs ${selectedLayerId === "legs" ? "is-selected" : ""}`} />}
          {visible("body") && <span className={`character-body ${selectedLayerId === "body" ? "is-selected" : ""}`} />}
          {visible("arm-right") && <span className={`character-arm character-arm--right ${selectedLayerId === "arm-right" ? "is-selected" : ""}`} />}
          {visible("arm-left") && <span className={`character-arm character-arm--left ${selectedLayerId === "arm-left" ? "is-selected" : ""}`} />}
          {visible("head") && <span className={`character-head ${selectedLayerId === "head" ? "is-selected" : ""}`} />}
          {visible("eye-right") && <span className={`character-eye character-eye--right ${selectedLayerId === "eye-right" ? "is-selected" : ""}`} />}
          {visible("eye-left") && <span className={`character-eye character-eye--left ${selectedLayerId === "eye-left" ? "is-selected" : ""}`} />}
          {visible("mouth") && <span className={`character-mouth ${selectedLayerId === "mouth" ? "is-selected" : ""}`} />}
        </div>
      )}
      {safeBounds && <span className="safe-bound-label">Safe 90%</span>}
    </div>
  );
}

export function ExportPdfPreview({
  layers,
  selectedLayerId,
  safeBounds,
  page,
  pages = [],
}: {
  layers: Layer[];
  selectedLayerId: string;
  safeBounds: boolean;
  page: number;
  pages?: Array<{ pageNumber: number; width: number; height: number }>;
}) {
  const pageSize = pages.find((item) => item.pageNumber === page) ?? {
    pageNumber: page,
    width: Math.max(
      1,
      ...layers
        .filter((layer) => layer.pageNumber === page)
        .map((layer) => (layer.bounds?.x ?? 0) + (layer.bounds?.width ?? 0)),
    ),
    height: Math.max(
      1,
      ...layers
        .filter((layer) => layer.pageNumber === page)
        .map((layer) => (layer.bounds?.y ?? 0) + (layer.bounds?.height ?? 0)),
    ),
  };
  const contentLayers = layers.filter(
    (layer) =>
      layer.pageNumber === page &&
      layer.kind !== "page" &&
      layer.visible &&
      layer.bounds,
  );
  return (
    <article
      className={`export-pdf-page ${safeBounds ? "show-safe-bounds" : ""}`}
      aria-label={`معاينة الصفحة ${page} من المستند الحقيقي`}
      style={
        {
          "--pdf-aspect": `${pageSize.width} / ${pageSize.height}`,
        } as React.CSSProperties
      }
    >
      {contentLayers.map((layer) => {
        const bounds = layer.bounds!;
        return (
          <div
            key={layer.id}
            className={`export-pdf-layer ${selectedLayerId === layer.id ? "is-selected" : ""}`}
            dir={layer.direction ?? "auto"}
            style={{
              insetInlineStart: `${(bounds.x / pageSize.width) * 100}%`,
              top: `${(bounds.y / pageSize.height) * 100}%`,
              width: `${(bounds.width / pageSize.width) * 100}%`,
              height: `${(bounds.height / pageSize.height) * 100}%`,
              opacity: layer.opacity / 100,
              fontFamily: layer.fontFamily,
              fontSize: `${Math.max(6, Math.min(18, ((layer.fontSize ?? bounds.height) / pageSize.height) * 520))}px`,
            }}
          >
            {layer.fullContent ?? layer.name.replace(/^\+/, "").replace(/_/gu, " ")}
          </div>
        );
      })}
      {contentLayers.length === 0 && (
        <p className="export-pdf-empty">لا توجد طبقات نص ظاهرة في هذه الصفحة.</p>
      )}
      {safeBounds && <span className="safe-bound-label">Safe 90%</span>}
    </article>
  );
}
