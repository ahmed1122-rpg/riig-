import { useEffect, useRef, useState } from "react";
import { MAX_IMAGE_UPLOAD_BYTES, MAX_PDF_UPLOAD_BYTES, type ExportFormat, type ProductionIssue } from "@motionprep/contracts";
import { ApiError } from "../../lib/api/transport";
import { getExportFormatPresentation } from "../../shared/exportPresentation";
import {
  selectExportFormat,
  selectExportScope,
  type ExportGenerationState,
} from "./exportFormatState";
import { ExportReviewHeader } from "./ExportReviewHeader";
import { ExportReviewFooter } from "./ExportReviewFooter";
import { ExportReviewPreviewPanel } from "./ExportReviewPreviewPanel";
import { ExportLayerReviewPanel } from "./ExportLayerReviewPanel";
import { ExportSetupPanel } from "./ExportSetupPanel";
import type {
  ExportReviewProps,
  PdfScope,
  PreviewBackground,
} from "./exportReviewTypes";
import { useExportReviewDialog } from "./useExportReviewDialog";
import { useExportPreviewZoom } from "./useExportPreviewZoom";
import { useExportReviewDerivedState } from "./useExportReviewDerivedState";

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

          <ExportLayerReviewPanel
            mode={mode}
            allLayers={layers}
            reviewableLayers={reviewableLayers}
            selected={selected}
            selectedLayerId={effectiveSelectedLayerId}
            pageCount={pageCount}
            fixedBackground={fixedBackground}
            generationState={generationState}
            onSelect={onSelectedLayerChange}
            onLayersChange={onLayersChange}
            onInvalidate={invalidateGeneratedExport}
          />

          <ExportSetupPanel
            mode={mode}
            maxUploadBytes={effectiveMaxUploadBytes}
            preflight={preflight}
            formats={formats}
            format={format}
            generationState={generationState}
            pdfScope={pdfScope}
            page={page}
            pageCount={pageCount}
            namingPresetId={namingPresetId}
            advancedOpen={advancedOpen}
            saveState={saveState}
            onRetrySave={onRetrySave}
            onFormatChange={changeFormat}
            onPdfScopeChange={changePdfScope}
            onAdvancedOpenChange={setAdvancedOpen}
            onRetryError={setGenerationMessage}
          />
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
