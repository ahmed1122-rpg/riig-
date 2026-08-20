import type { MutableRefObject } from "react";
import type {
  ApplicationCapabilities,
  LayerDocumentCommand,
} from "@motionprep/contracts";
import { Icon } from "../../shared/Icon";
import type { ConfirmationRequest } from "../../shared/useConfirmation";
import type { Layer, PdfSegmentation, ProjectMode } from "../../types";
import type { LayerDocumentView } from "../../lib/api";
import { ImageGuidanceEditor, PdfGuidanceEditor } from "./GuidedEditors";
import { LayerDock } from "./LayerDock";
import {
  PreviewToolbar,
  type PreviewBackground,
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
import type { DocumentChangeSummary } from "./documentChangeSummary";
import type { LayerCheckSummary } from "./layerChecks";
import { useWorkspaceCanvasNavigation } from "./useWorkspaceCanvasNavigation";
import { useWorkspaceFileDrop } from "./useWorkspaceFileDrop";

interface WorkspaceEditorLayoutModel {
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
  grid: boolean;
  safeBounds: boolean;
  solo: boolean;
  focusMode: boolean;
  onZoomChange: (value: number) => void;
  onPreviewBackgroundChange: (value: PreviewBackground) => void;
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
  onLayerCommand: (command: LayerDocumentCommand) => Promise<void>;
  documentChangeLog: readonly DocumentChangeSummary[];
  layerCheckSummary: LayerCheckSummary;
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
  onConfirm: (request: ConfirmationRequest) => Promise<boolean>;
  onToolSelect: (toolId: ReadyWorkspaceToolId) => void;
  onRequireAuth: () => void;
  onNotify: (message: string) => void;
}

import type { WorkspaceEditorLayoutProps } from "./WorkspaceEditorLayoutProps";

export function WorkspaceEditorLayout({
  context,
  source,
  review,
  editor,
  tools,
  actions,
}: WorkspaceEditorLayoutProps) {
  const props: WorkspaceEditorLayoutModel = {
    mode: context.mode,
    authenticated: context.authenticated,
    maxUploadBytes: context.maxUploadBytes,
    persistedSource: source.persistedSource,
    sourceName: source.sourceName,
    sourceVersion: source.sourceVersion,
    sourceHash: source.sourceHash,
    uploadState: source.uploadState,
    uploadProgress: source.uploadProgress,
    uploadDetailsOpen: source.uploadDetailsOpen,
    uploadError: source.uploadError,
    fileRef: actions.fileRef,
    chooseSource: actions.chooseSource,
    cancelUpload: actions.cancelUpload,
    onToggleUploadDetails: () =>
      source.setUploadDetailsOpen((current) => !current),
    tools: tools.workspaceTools,
    activeTool: tools.activeTool,
    toolCollapsed: editor.toolCollapsed,
    onToolCollapsedChange: editor.setToolCollapsed,
    onUseTool: tools.useTool,
    zoom: editor.zoom,
    previewBackground: editor.previewBackground,
    grid: editor.grid,
    safeBounds: editor.safeBounds,
    solo: editor.solo,
    focusMode: editor.focusMode,
    onZoomChange: editor.setZoom,
    onPreviewBackgroundChange: editor.setPreviewBackground,
    onGridChange: editor.setGrid,
    onSafeBoundsChange: editor.setSafeBounds,
    onSoloChange: editor.setSolo,
    onFocusModeChange: editor.setFocusMode,
    imageLayers: review.imageLayers,
    bookLayers: review.bookLayers,
    layers: review.layers,
    hiddenLayers: actions.hiddenLayers,
    selectedIds: review.selectedIds,
    activeLayerId: review.activeLayerId,
    onSelectLayer: (id) => void actions.onSelectLayer(id),
    onLayerSelectionChange: (ids, activeId) =>
      void actions.onSelectLayer(activeId, ids),
    onLayersChange: review.setLayers,
    layersCollapsed: editor.layersCollapsed,
    layerWidth: editor.layerWidth,
    layerLoading: editor.layerLoading,
    onLayersCollapsedChange: editor.setLayersCollapsed,
    onLayerWidthChange: editor.setLayerWidth,
    onLayerCommand: actions.onLayerCommand,
    documentChangeLog: actions.documentChangeLog,
    layerCheckSummary: actions.layerCheckSummary,
    guidanceRevision: source.guidanceRevision,
    imagePreparation: source.imagePreparation,
    ocrReview: source.ocrReview,
    imageCanvasSize: source.imageCanvasSize,
    sourcePreviewUrl: source.sourcePreviewUrl,
    pdfMode: editor.pdfMode,
    pdfPages: source.pdfPages,
    activePdfPage: source.activePdfPage,
    pdfPageCount: source.pdfPageCount,
    pdfPageSize: source.pdfPageSize,
    processing: source.processing,
    editorCommand: tools.editorCommand,
    onApplyImageGuide: actions.onApplyImageGuide,
    onApplyPdfGuide: actions.onApplyPdfGuide,
    onHistoryNavigate: actions.onHistoryNavigate,
    onPdfSegmentationChange: actions.onPdfSegmentationChange,
    onConfirm: actions.onConfirm,
    onToolSelect: tools.selectEditorTool,
    onRequireAuth: context.onRequireAuth,
    onNotify: context.onNotify,
  };
  const requestSourceSelection = () => {
    if (props.authenticated) {
      props.fileRef.current?.click();
      return;
    }
    props.onNotify("سجّل الدخول قبل اختيار الملف؛ يمكنك استكشاف الأدوات كضيف دون رفع بيانات.");
    props.onRequireAuth();
  };
  const canvasNavigation = useWorkspaceCanvasNavigation(
    props.onZoomChange,
    `${props.mode}:${props.sourceVersion}:${props.activePdfPage}`,
  );
  const fileDrop = useWorkspaceFileDrop(props.chooseSource, props.onNotify);
  const previewClassName = [
    "pro-editor-frame",
    `preview-bg--${props.previewBackground}`,
    props.grid ? "preview-grid-on" : "preview-grid-off",
    props.safeBounds ? "preview-safe" : "",
    canvasNavigation.navigationClassName,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={`pro-workspace-body ${fileDrop.dragActive ? "is-file-drag-active" : ""}`}
      onDragEnter={fileDrop.onDragEnter}
      onDragLeave={fileDrop.onDragLeave}
      onDragOver={fileDrop.onDragOver}
      onDrop={fileDrop.onDrop}
    >
      {fileDrop.dragActive && (
        <div className="pro-workspace-dropzone" role="status">
          <Icon name="upload" size={32} />
          <strong>أفلت ملف المصدر هنا</strong>
          <span>{props.mode === "image" ? "PNG أو JPG أو WebP أو AVIF أو TIFF أو BMP" : "ملف PDF واحد"}</span>
        </div>
      )}
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
          grid={props.grid}
          safeBounds={props.safeBounds}
          solo={props.solo}
          focusMode={props.focusMode}
          onZoomChange={props.onZoomChange}
          onBackgroundChange={props.onPreviewBackgroundChange}
          onGridChange={props.onGridChange}
          onSafeBoundsChange={props.onSafeBoundsChange}
          onSoloChange={props.onSoloChange}
          onFocusModeChange={props.onFocusModeChange}
          onFit={canvasNavigation.fitPreview}
        />

        <div
          ref={canvasNavigation.containerRef}
          className={previewClassName}
          style={canvasNavigation.navigationStyle}
          onPointerDown={canvasNavigation.onPointerDown}
          onPointerMove={canvasNavigation.onPointerMove}
          onPointerUp={canvasNavigation.onPointerUp}
          onPointerCancel={canvasNavigation.onPointerUp}
        >
          {!props.persistedSource ? (
            <EmptySourcePreview
              mode={props.mode}
              maxUploadBytes={props.maxUploadBytes}
              onChoose={requestSourceSelection}
            />
          ) : props.mode === "image" ? (
            <ImageGuidanceEditor
              key={`image-source-${props.sourceVersion}`}
              layers={props.imageLayers}
              hiddenLayers={props.hiddenLayers}
              selectedLayerId={props.activeLayerId}
              onSelectedLayerChange={props.onSelectLayer}
              onNotify={props.onNotify}
              guidanceRevision={props.guidanceRevision}
              onApply={props.onApplyImageGuide}
              onHistoryNavigate={props.onHistoryNavigate}
              onDraftDirtyChange={actions.onDraftDirtyChange}
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
              key={`pdf-source-${props.sourceVersion}-page-${props.activePdfPage}`}
              segmentation={props.pdfMode}
              layers={props.bookLayers}
              pageNumber={props.activePdfPage}
              pageCount={props.pdfPageCount}
              selectedLayerId={props.activeLayerId}
              solo={props.solo}
              onSelectedLayerChange={props.onSelectLayer}
              onTextLayerChange={(layerId, fullText) =>
                props.onLayersChange(
                  props.layers.map((layer) =>
                    layer.id === layerId ? { ...layer, fullText } : layer,
                  ),
                )
              }
              {...(props.pdfPageSize ? { pageSize: props.pdfPageSize } : {})}
              onPageChange={(nextPage) => {
                void actions.onPdfPageChange(nextPage);
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
              onDraftDirtyChange={actions.onDraftDirtyChange}
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
          activePdfPage={props.activePdfPage}
          pdfPages={props.pdfPages}
          canReorder
          onCollapsedChange={props.onLayersCollapsedChange}
          onWidthChange={props.onLayerWidthChange}
          onSelectionChange={props.onLayerSelectionChange}
          onPdfPageChange={actions.onPdfPageChange}
          onLayersChange={props.onLayersChange}
          onLayerCommand={props.onLayerCommand}
          documentChangeLog={props.documentChangeLog}
          checkSummary={props.layerCheckSummary}
          onNotify={props.onNotify}
        />
      ) : (
        <EmptyLayerDock />
      )}
    </div>
  );
}
