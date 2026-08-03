import type { MutableRefObject } from "react";
import type { ApplicationCapabilities } from "@motionprep/contracts";
import { Icon } from "../../shared/Icon";
import type { ConfirmationRequest } from "../../shared/useConfirmation";
import type { Layer, PdfSegmentation, ProjectMode } from "../../types";
import type { LayerDocumentView } from "../../lib/api";
import { ImageGuidanceEditor, PdfGuidanceEditor } from "./GuidedEditors";
import { LayerDock } from "./LayerDock";
import {
  PreviewToolbar,
  type PreviewBackground,
  type PreviewQuality,
} from "./PreviewToolbar";
import { SourceUploadStatus, type UploadState } from "./SourceUploadStatus";
import { WorkspaceToolRail } from "./WorkspaceToolRail";
import { EmptyLayerDock, EmptySourcePreview } from "./WorkspaceEmptyStates";
import type {
  ReadyWorkspaceToolId,
  ResolvedWorkspaceTool,
  WorkspaceEditorCommand,
} from "./workspaceToolRegistry";
import type {
  ImageGuideInput,
  PdfGuideInput,
} from "./workspaceGuidance";

interface WorkspaceEditorLayoutProps {
  mode: ProjectMode;
  authenticated: boolean;
  maxUploadBytes: ApplicationCapabilities["limits"]["maxUploadBytes"];
  persistedSource: boolean;
  sourceName: string;
  sourceVersion: number;
  sourceHash: string | undefined;
  uploadState: UploadState;
  uploadProgress: number;
  uploadDetailsOpen: boolean;
  uploadError: string | undefined;
  fileRef: MutableRefObject<HTMLInputElement | null>;
  chooseSource: (file?: File) => Promise<void>;
  cancelUpload: () => void;
  onToggleUploadDetails: () => void;
  tools: readonly ResolvedWorkspaceTool[];
  activeTool: ReadyWorkspaceToolId;
  toolCollapsed: boolean;
  onToolCollapsedChange: (value: boolean) => void;
  onUseTool: (tool: ResolvedWorkspaceTool) => void;
  zoom: number;
  previewBackground: PreviewBackground;
  previewQuality: PreviewQuality;
  grid: boolean;
  safeBounds: boolean;
  solo: boolean;
  focusMode: boolean;
  onZoomChange: (value: number) => void;
  onPreviewBackgroundChange: (value: PreviewBackground) => void;
  onPreviewQualityChange: (value: PreviewQuality) => void;
  onGridChange: (value: boolean) => void;
  onSafeBoundsChange: (value: boolean) => void;
  onSoloChange: (value: boolean) => void;
  onFocusModeChange: (value: boolean) => void;
  imageLayers: Layer[];
  bookLayers: Layer[];
  layers: Layer[];
  hiddenLayers: string[];
  selectedIds: string[];
  activeLayerId: string;
  onSelectLayer: (id: string) => void;
  onLayerSelectionChange: (ids: string[], activeId: string) => void;
  onLayersChange: (layers: Layer[]) => void;
  layersCollapsed: boolean;
  layerWidth: number;
  layerLoading: boolean;
  onLayersCollapsedChange: (value: boolean) => void;
  onLayerWidthChange: (value: number) => void;
  onArrangeReadingOrder: () => void;
  guidanceRevision: number;
  imagePreparation: LayerDocumentView["imagePreparation"];
  ocrReview: LayerDocumentView["ocrReview"];
  imageCanvasSize: { width: number; height: number } | undefined;
  sourcePreviewUrl: string | undefined;
  pdfMode: PdfSegmentation;
  pdfPages: Array<{ pageNumber: number; width: number; height: number }>;
  activePdfPage: number;
  pdfPageCount: number;
  pdfPageSize: { width: number; height: number } | undefined;
  processing: boolean;
  editorCommand: WorkspaceEditorCommand | undefined;
  onApplyImageGuide: (
    input: ImageGuideInput,
  ) => Promise<{ revision: number; warnings: string[] }>;
  onApplyPdfGuide: (
    input: PdfGuideInput,
  ) => Promise<{ revision: number; warnings: string[] }>;
  onHistoryNavigate: (direction: "undo" | "redo") => Promise<void>;
  onPdfSegmentationChange: (mode: PdfSegmentation) => Promise<void>;
  onPdfPageChange: (
    page: number,
    size: { width: number; height: number } | undefined,
  ) => void;
  onConfirm: (request: ConfirmationRequest) => Promise<boolean>;
  onToolSelect: (toolId: ReadyWorkspaceToolId) => void;
  onRequireAuth: () => void;
  onNotify: (message: string) => void;
}

export function WorkspaceEditorLayout(props: WorkspaceEditorLayoutProps) {
  const requestSourceSelection = () => {
    if (props.authenticated) {
      props.fileRef.current?.click();
      return;
    }
    props.onNotify("سجّل الدخول قبل اختيار الملف؛ يمكنك استكشاف الأدوات كضيف دون رفع بيانات.");
    props.onRequireAuth();
  };
  const previewClassName = [
    "pro-editor-frame",
    `preview-bg--${props.previewBackground}`,
    props.grid ? "preview-grid-on" : "preview-grid-off",
    props.safeBounds ? "preview-safe" : "",
    props.previewQuality === "full"
      ? "preview-quality-full"
      : "preview-quality-fast",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className="pro-workspace-body">
      <WorkspaceToolRail
        mode={props.mode}
        tools={props.tools}
        activeTool={props.activeTool}
        collapsed={props.toolCollapsed}
        onCollapsedChange={props.onToolCollapsedChange}
        onToolChange={props.onUseTool}
      />

      <section
        className="pro-preview-column"
        aria-label="المعاينة الاحترافية"
      >
        <div className="pro-source-row">
          <SourceUploadStatus
            mode={props.mode}
            maxUploadBytes={props.maxUploadBytes}
            fileName={props.sourceName}
            version={props.sourceVersion}
            state={props.uploadState}
            progress={props.uploadProgress}
            detailsOpen={props.uploadDetailsOpen}
            {...(props.uploadError ? { error: props.uploadError } : {})}
            {...(props.sourceHash ? { hash: props.sourceHash } : {})}
            onChoose={requestSourceSelection}
            onToggleDetails={props.onToggleUploadDetails}
            onCancel={props.cancelUpload}
            onRetry={requestSourceSelection}
          />
          <input
            ref={props.fileRef}
            className="sr-only"
            type="file"
            aria-label={
              props.mode === "image"
                ? "اختيار ملف صورة للمشروع"
                : "اختيار ملف PDF للمشروع"
            }
            accept={
              props.mode === "image"
                ? ".png,.jpg,.jpeg,.webp,.avif,.tif,.tiff,.bmp"
                : ".pdf"
            }
            onChange={(event) => {
              void props.chooseSource(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          {props.mode === "book" &&
          props.ocrReview?.pages.some(
            (page) => page.pageNumber === props.activePdfPage,
          ) ? (
            <span
              className="ocr-review-tag"
              role="status"
              title="ثقة القراءة الضوئية أقل من حد المراجعة؛ النص محفوظ ولم يُحذف."
            >
              <Icon name="warning" size={14} />
              OCR يحتاج مراجعة بشرية
            </span>
          ) : (
            <span className="demo-tag">
              <Icon name="spark" size={14} />
              {props.mode === "image" && props.persistedSource
                ? props.imagePreparation?.strategy === "alpha-components"
                  ? `${props.imagePreparation.outputLayers} طبقات Raster فعلية`
                  : "طبقة Raster أصلية"
                : "معاينة إرشادية قبل رفع المصدر"}
            </span>
          )}
        </div>

        <PreviewToolbar
          zoom={props.zoom}
          background={props.previewBackground}
          quality={props.previewQuality}
          grid={props.grid}
          safeBounds={props.safeBounds}
          solo={props.solo}
          focusMode={props.focusMode}
          onZoomChange={props.onZoomChange}
          onBackgroundChange={props.onPreviewBackgroundChange}
          onQualityChange={props.onPreviewQualityChange}
          onGridChange={props.onGridChange}
          onSafeBoundsChange={props.onSafeBoundsChange}
          onSoloChange={props.onSoloChange}
          onFocusModeChange={props.onFocusModeChange}
        />

        <div className={previewClassName}>
          {!props.persistedSource ? (
            <EmptySourcePreview
              mode={props.mode}
              maxUploadBytes={props.maxUploadBytes}
              onChoose={requestSourceSelection}
            />
          ) : props.mode === "image" ? (
            <ImageGuidanceEditor
              layers={props.imageLayers}
              hiddenLayers={props.hiddenLayers}
              selectedLayerId={props.activeLayerId}
              onSelectedLayerChange={props.onSelectLayer}
              onNotify={props.onNotify}
              guidanceRevision={props.guidanceRevision}
              onApply={props.onApplyImageGuide}
              onHistoryNavigate={props.onHistoryNavigate}
              {...(props.imagePreparation
                ? { preparation: props.imagePreparation }
                : {})}
              onToolSelect={props.onToolSelect}
              {...(props.editorCommand
                ? { toolCommand: props.editorCommand }
                : {})}
              {...(props.imageCanvasSize
                ? { canvasSize: props.imageCanvasSize }
                : {})}
              {...(props.sourcePreviewUrl
                ? { sourcePreviewUrl: props.sourcePreviewUrl }
                : {})}
            />
          ) : (
            <PdfGuidanceEditor
              key={`pdf-page-${props.activePdfPage}`}
              segmentation={props.pdfMode}
              layers={props.bookLayers}
              pageNumber={props.activePdfPage}
              pageCount={props.pdfPageCount}
              {...(props.pdfPageSize ? { pageSize: props.pdfPageSize } : {})}
              onPageChange={(nextPage) => {
                const page =
                  props.pdfPages.find(
                    (candidate) => candidate.pageNumber === nextPage,
                  ) ?? props.pdfPages[0];
                props.onPdfPageChange(
                  page?.pageNumber ?? nextPage,
                  page
                    ? { width: page.width, height: page.height }
                    : undefined,
                );
                const nextLayer = props.bookLayers.find(
                  (layer) =>
                    layer.pageNumber === nextPage && layer.kind !== "page",
                );
                if (nextLayer) props.onSelectLayer(nextLayer.id);
              }}
              onSegmentationChange={props.onPdfSegmentationChange}
              segmentationBusy={props.processing}
              onNotify={props.onNotify}
              guidanceRevision={props.guidanceRevision}
              onApply={props.onApplyPdfGuide}
              onHistoryNavigate={props.onHistoryNavigate}
              onConfirmDiscardRegions={(message) =>
                props.onConfirm({
                  title: "تجاهل المناطق غير المحفوظة؟",
                  description: message,
                  confirmLabel: "تجاهل والانتقال",
                  tone: "danger",
                })
              }
              onToolSelect={props.onToolSelect}
              {...(props.editorCommand
                ? { toolCommand: props.editorCommand }
                : {})}
            />
          )}
        </div>
      </section>

      {props.persistedSource ? (
        <LayerDock
          mode={props.mode}
          layers={props.layers}
          selectedIds={props.selectedIds}
          activeId={props.activeLayerId}
          collapsed={props.layersCollapsed}
          width={props.layerWidth}
          loading={props.layerLoading}
          canReorder
          onCollapsedChange={props.onLayersCollapsedChange}
          onWidthChange={props.onLayerWidthChange}
          onSelectionChange={props.onLayerSelectionChange}
          onLayersChange={props.onLayersChange}
          onArrangeReadingOrder={props.onArrangeReadingOrder}
          onNotify={props.onNotify}
        />
      ) : (
        <EmptyLayerDock />
      )}
    </main>
  );
}
