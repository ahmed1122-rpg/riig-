import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ExportFormat } from "@motionprep/contracts";
import { Icon } from "../../shared/Icon";
import type { Layer } from "../../types";
import type { ExportGenerationState } from "./exportFormatState";
import { ExportCharacterPreview, ExportPdfPreview } from "./ExportReviewPreviews";
import type {
  ExportReviewProps,
  PdfScope,
  PreviewBackground,
} from "./exportReviewTypes";

export function ExportReviewPreviewPanel({
  mode,
  background,
  zoom,
  fitActive,
  stageRef,
  scaleRef,
  setZoom,
  fitPreview,
  setBackground,
  safeBounds,
  setSafeBounds,
  layers,
  selectedLayerId,
  canvasSize,
  sourcePreviewUrl,
  page,
  pdfPages,
  pageCount,
  pdfScope,
  generationState,
  invalidateGeneratedExport,
  setPage,
  format,
}: {
  mode: ExportReviewProps["mode"];
  background: PreviewBackground;
  zoom: number;
  fitActive: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  scaleRef: RefObject<HTMLDivElement | null>;
  setZoom: Dispatch<SetStateAction<number>>;
  fitPreview: () => void;
  setBackground: Dispatch<SetStateAction<PreviewBackground>>;
  safeBounds: boolean;
  setSafeBounds: Dispatch<SetStateAction<boolean>>;
  layers: Layer[];
  selectedLayerId: string;
  canvasSize: ExportReviewProps["canvasSize"];
  sourcePreviewUrl: string | undefined;
  page: number;
  pdfPages: ExportReviewProps["pdfPages"];
  pageCount: number;
  pdfScope: PdfScope;
  generationState: ExportGenerationState;
  invalidateGeneratedExport: () => void;
  setPage: Dispatch<SetStateAction<number>>;
  format: ExportFormat;
}) {
  return (
    <section className="export-preview-panel" aria-label="المعاينة النهائية">
      <div className="export-preview-toolbar">
        <div className="preview-group" aria-label="تكبير المعاينة">
          <button type="button" onClick={() => setZoom((value) => Math.max(30, value - 10))} aria-label="تصغير"><Icon name="zoomOut" size={16} /></button>
          <button type="button" className="zoom-value" onClick={() => setZoom(100)} aria-label="عرض مئة بالمئة">{zoom}%</button>
          <button type="button" onClick={() => setZoom((value) => Math.min(160, value + 10))} aria-label="تكبير"><Icon name="zoomIn" size={16} /></button>
          <button type="button" aria-pressed={fitActive} onClick={fitPreview}>ملاءمة</button>
          <button type="button" onClick={() => setZoom(100)}>100%</button>
        </div>
        <div className="preview-group background-switch" role="radiogroup" aria-label="خلفية المعاينة">
          <button type="button" onClick={() => setBackground("white")} aria-pressed={background === "white"}>بيضاء</button>
          {mode === "image" && (
            <>
              <button type="button" onClick={() => setBackground("transparent")} aria-pressed={background === "transparent"}>شفافة</button>
              <button type="button" onClick={() => setBackground("checker")} aria-pressed={background === "checker"}>شبكية</button>
            </>
          )}
        </div>
        <button className="safe-toggle" type="button" onClick={() => setSafeBounds((value) => !value)} aria-pressed={safeBounds}>
          <Icon name="scan" size={15} /> حدود الأمان
        </button>
      </div>

      <div ref={stageRef} className={`export-preview-stage preview-bg--${background}`}>
        <div ref={scaleRef} className="export-preview-scale" style={{ "--review-zoom": zoom / 100 } as React.CSSProperties}>
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
  );
}
