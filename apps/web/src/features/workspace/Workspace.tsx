import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirmation } from "../../shared/useConfirmation";
import { ShortcutsModal } from "../../shared/ShortcutsModal";
import type { Layer, PdfSegmentation, ProjectMode } from "../../types";
import type { PreviewBackground, PreviewQuality } from "./PreviewToolbar";
import type { UploadState } from "./SourceUploadStatus";
import {
  WorkspaceHeader,
  WorkspacePipeline,
  WorkspaceStatusBar,
  type WorkspaceMobilePanel,
  type WorkspaceSaveState,
} from "./WorkspaceChrome";
import { useWorkspacePreference } from "./useWorkspacePreference";
import { getLayerCheckSummary } from "./layerChecks";
import { storedPdfSegmentation } from "./pdfSegmentation";
import { storedPreviewQuality } from "./workspaceDocument";
import { getWorkspacePipeline } from "./workspacePresentation";
import { isWorkspaceRevisionConflict } from "./workspaceConflict";
import type { LayerDocumentView } from "../../lib/api";
import { useWorkspaceReviewAutosave } from "./useWorkspaceReviewAutosave";
import { useWorkspaceToolController } from "./useWorkspaceToolController";
import { WorkspaceEditorLayout } from "./WorkspaceEditorLayout";
import { WorkspaceDialogs } from "./WorkspaceDialogs";
import { useWorkspaceProjectLifecycle } from "./useWorkspaceProjectLifecycle";
import { useWorkspaceCommands } from "./useWorkspaceCommands";
import { useWorkspaceNavigationGuard } from "./useWorkspaceNavigationGuard";
import { useWorkspaceShortcutHelp } from "./useWorkspaceShortcutHelp";
import type { WorkspaceProps } from "./Workspace.types";

export function Workspace({
  mode,
  capabilities,
  authenticated,
  onRequireAuth,
  onModeChange,
  onBack,
  onNavigationGuardChange,
  onNotify,
  initialProject,
}: WorkspaceProps) {
  const [imageLayers, setImageLayers] = useState<Layer[]>([]);
  const [bookLayers, setBookLayers] = useState<Layer[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeLayerId, setActiveLayerId] = useState("");
  const [mobilePanel, setMobilePanel] = useState<WorkspaceMobilePanel>("none");
  const [pdfMode, setPdfMode] = useState<PdfSegmentation>(storedPdfSegmentation);
  const [exportOpen, setExportOpen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [previewBackground, setPreviewBackground] = useState<PreviewBackground>(mode === "image" ? "dark" : "white");
  const [previewQuality, setPreviewQuality] = useState<PreviewQuality>(storedPreviewQuality);
  const [grid, setGrid] = useState(true);
  const [safeBounds, setSafeBounds] = useState(true);
  const [solo, setSolo] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [layerLoading, setLayerLoading] = useState(false);
  const [sourceName, setSourceName] = useState(mode === "image" ? "اختر صورة واحدة" : "اختر ملف PDF واحدًا");
  const [sourceVersion, setSourceVersion] = useState(0);
  const [uploadState, setUploadState] = useState<UploadState>("empty");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string>();
  const [uploadDetailsOpen, setUploadDetailsOpen] = useState(false);
  const [projectId, setProjectId] = useState<string>();
  const [sourceVersionId, setSourceVersionId] = useState<string>();
  const [sourceHash, setSourceHash] = useState<string>();
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string>();
  const [imageCanvasSize, setImageCanvasSize] = useState<{
    width: number;
    height: number;
  }>();
  const [imagePreparation, setImagePreparation] = useState<LayerDocumentView["imagePreparation"]>();
  const [ocrReview, setOcrReview] = useState<LayerDocumentView["ocrReview"]>();
  const [layerDocumentRevision, setLayerDocumentRevision] = useState<number>();
  const [guidanceRevision, setGuidanceRevision] = useState(0);
  const [saveState, setSaveState] = useState<WorkspaceSaveState>("idle");
  const [pdfPageSize, setPdfPageSize] = useState<{
    width: number;
    height: number;
  }>();
  const [pdfPages, setPdfPages] = useState<Array<{ pageNumber: number; width: number; height: number }>>([]);
  const [activePdfPage, setActivePdfPage] = useState(1);
  const [pdfPageCount, setPdfPageCount] = useState(1);
  const [toolCollapsed, setToolCollapsed] = useWorkspacePreference("motionprep.workspace.tools-collapsed", false);
  const [layersCollapsed, setLayersCollapsed] = useWorkspacePreference("motionprep.workspace.layers-collapsed", false);
  const [layerWidth, setLayerWidth] = useWorkspacePreference("motionprep.workspace.layers-width", 326);
  const fileRef = useRef<HTMLInputElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement | null>(null);
  const { requestConfirmation, confirmationDialog } = useConfirmation();
  const { shortcutsOpen, closeShortcuts } = useWorkspaceShortcutHelp();

  const layers = mode === "image" ? imageLayers : bookLayers;
  const setLayers = mode === "image" ? setImageLayers : setBookLayers;
  const activeLayer = useMemo(() => layers.find((layer) => layer.id === activeLayerId) ?? layers[0], [activeLayerId, layers]);
  const persistedSource = Boolean(projectId && sourceVersionId);
  const {
    activeTool,
    arrangeReadingOrder,
    editorCommand,
    imageRasterOperation,
    pdfRegionOcrLayerId,
    pdfTextOperation,
    resetToolState,
    selectEditorTool,
    setImageRasterOperation,
    setPdfRegionOcrLayerId,
    setPdfTextOperation,
    setSourceVersionsOpen,
    sourceVersionsOpen,
    useTool,
    workspaceTools,
  } = useWorkspaceToolController({
    mode,
    persistedSource,
    features: capabilities.features,
    activeLayer,
    selectedIds,
    imageLayers,
    bookLayers,
    setBookLayers,
    onNotify,
  });
  const pdfRegionOcrLayer = useMemo(
    () => bookLayers.find((layer) => layer.id === pdfRegionOcrLayerId),
    [bookLayers, pdfRegionOcrLayerId],
  );
  const pdfRegionOcrPageSize = useMemo(
    () =>
      pdfPages.find(
        (page) => page.pageNumber === pdfRegionOcrLayer?.pageNumber,
      ),
    [pdfPages, pdfRegionOcrLayer?.pageNumber],
  );
  const handleRevisionConflict = useCallback(
    async (error: unknown): Promise<void> => {
      if (!isWorkspaceRevisionConflict(error)) return;
      const reload = await requestConfirmation({
        title: "توجد نسخة أحدث من المستند",
        description:
          "حُفظت تعديلات أخرى بعد فتح هذه الصفحة. أعد تحميل أحدث نسخة قبل متابعة التحرير؛ ستُستبدل التغييرات المحلية غير المحفوظة.",
        confirmLabel: "تحميل أحدث نسخة",
        cancelLabel: "البقاء للمراجعة",
        tone: "danger",
      });
      if (reload) {
        window.location.reload();
        return;
      }
      onNotify(
        "أُوقف الحفظ لحماية النسخة الأحدث. انسخ أي نص محلي مهم ثم أعد تحميل المشروع.",
      );
    },
    [onNotify, requestConfirmation],
  );
  const {
    flushLayerReview,
    hasUnsavedReview,
    saveInFlightRef,
    adoptSavedReview,
    resetSavedReview,
  } = useWorkspaceReviewAutosave({
    ...(projectId ? { projectId } : {}),
    ...(sourceVersionId ? { sourceVersionId } : {}),
    persistedSource,
    ...(layerDocumentRevision === undefined
      ? {}
      : { revision: layerDocumentRevision }),
    layers,
    setRevision: setLayerDocumentRevision,
    setSaveState,
    onNotify,
    onRevisionConflict: handleRevisionConflict,
  });
  useWorkspaceNavigationGuard({
    hasUnsavedReview,
    flushLayerReview,
    onNavigationGuardChange,
    onNotify,
  });
  const layerCheckSummary = useMemo(
    () => getLayerCheckSummary(mode, layers),
    [layers, mode],
  );
  const hiddenLayers = useMemo(
    () => imageLayers.filter((layer) => !layer.visible || (solo && layer.id !== activeLayerId)).map((layer) => layer.id),
    [activeLayerId, imageLayers, solo],
  );
  const pipeline = getWorkspacePipeline(
    mode,
    sourceVersion,
    imageLayers.length,
    pdfMode,
  );

  const resetLayerSelection = useCallback(
    (preparedLayers: readonly Layer[]) => {
      const firstLayerId = preparedLayers[0]?.id ?? "";
      setActiveLayerId(firstLayerId);
      setSelectedIds(firstLayerId ? [firstLayerId] : []);
      resetToolState(mode);
    },
    [mode, resetToolState],
  );
  const { applyPreparedDocument, cancelUpload, chooseSource, replaceLayerAssetUrls } =
    useWorkspaceProjectLifecycle({
    mode,
    maxUploadBytes: capabilities.limits.maxUploadBytes,
    authenticated,
    persistedSource,
    sourceName,
    ...(projectId ? { projectId } : {}),
    ...(sourceVersionId ? { sourceVersionId } : {}),
    ...(sourcePreviewUrl ? { sourcePreviewUrl } : {}),
    pdfMode,
    initialProject,
    onRequireAuth,
    onNotify,
    requestConfirmation,
    adoptSavedReview,
    resetLayerSelection,
    setImageLayers,
    setBookLayers,
    setProjectId,
    setSourceVersionId,
    setSourceHash,
    setSourcePreviewUrl,
    setImageCanvasSize,
    setImagePreparation,
    setOcrReview,
    setGuidanceRevision,
    setSourceVersion,
    setSourceName,
    setUploadState,
    setUploadProgress,
    setUploadError,
    setUploadDetailsOpen,
    setPdfPages,
    setActivePdfPage,
    setPdfPageSize,
    setPdfPageCount,
  });
  const {
    applyImageGuide,
    applyImageRasterOperation,
    applyPdfGuide,
    applyPdfRegionOcr,
    applyPdfTextOperation,
    changePdfSegmentation,
    createExport,
    navigateDocumentHistory,
    restoreSourceVersion,
  } = useWorkspaceCommands({
    mode,
    pdfMode,
    ...(projectId ? { projectId } : {}),
    ...(sourceVersionId ? { sourceVersionId } : {}),
    activeLayerId,
    activePdfPage,
    guidanceRevision,
    ...(layerDocumentRevision === undefined
      ? {}
      : { layerDocumentRevision }),
    pdfTextOperation,
    imageRasterOperation,
    pdfRegionOcrLayer,
    pdfRegionOcrPageSize,
    saveInFlightRef,
    flushLayerReview,
    replaceLayerAssetUrls,
    applyPreparedDocument,
    adoptSavedReview,
    resetLayerSelection,
    requestConfirmation,
    setProcessing,
    setSaveState,
    setUploadState,
    setUploadProgress,
    setUploadError,
    setUploadDetailsOpen,
    setPdfMode,
    setGuidanceRevision,
    setActiveLayerId,
    setSelectedIds,
    setSourceVersionId,
    setSourceVersion,
    setSourceName,
    setSourceHash,
    setSourcePreviewUrl,
    onNotify,
  });

  useEffect(() => {
    setLayerLoading(true);
    const timer = window.setTimeout(() => setLayerLoading(false), 260);
    return () => window.clearTimeout(timer);
  }, [mode]);

  const switchMode = (nextMode: ProjectMode) => {
    replaceLayerAssetUrls([]);
    onModeChange(nextMode);
    const nextLayers = nextMode === "image" ? imageLayers : bookLayers;
    const nextLayerId = nextLayers[0]?.id ?? "";
    setActiveLayerId(nextLayerId);
    setSelectedIds(nextLayerId ? [nextLayerId] : []);
    resetToolState(nextMode);
    setSourceName(nextMode === "image" ? "اختر صورة واحدة" : "اختر ملف PDF واحدًا");
    setSourceVersion(0);
    setPreviewBackground(nextMode === "image" ? "dark" : "white");
    setUploadState("empty");
    setUploadProgress(0);
    setProjectId(undefined);
    setSourceVersionId(undefined);
    setSourceHash(undefined);
    setSourcePreviewUrl(undefined);
    setImageCanvasSize(undefined);
    setImagePreparation(undefined);
    setOcrReview(undefined);
    resetSavedReview();
    setGuidanceRevision(0);
    setPdfPageSize(undefined);
    setPdfPages([]);
    setActivePdfPage(1);
    setPdfPageCount(1);
  };

  const openExportReview = (event: React.MouseEvent<HTMLButtonElement>) => {
    exportTriggerRef.current = event.currentTarget;
    setExportOpen(true);
  };

  return (
    <div
      className={`workspace workspace--${mode} pro-workspace ${focusMode ? "is-preview-focus" : ""} ${toolCollapsed ? "tools-collapsed" : ""} ${layersCollapsed ? "layers-collapsed" : ""}`}
      style={{ "--layer-dock-width": `${layerWidth}px`, "--preview-zoom": zoom } as React.CSSProperties}
    >
      <WorkspaceHeader
        mode={mode}
        persistedSource={persistedSource}
        sourceName={sourceName}
        saveState={saveState}
        imageLayerCount={imageLayers.length}
        activePdfPage={activePdfPage}
        pdfPageCount={pdfPageCount}
        pdfMode={pdfMode}
        exportTriggerRef={exportTriggerRef}
        onBack={onBack}
        onModeChange={switchMode}
        onExport={openExportReview}
      />

      <WorkspacePipeline
        steps={pipeline}
        persistedSource={persistedSource}
      />

      <WorkspaceEditorLayout
        mode={mode}
        authenticated={authenticated}
        maxUploadBytes={capabilities.limits.maxUploadBytes}
        persistedSource={persistedSource}
        sourceName={sourceName}
        sourceVersion={sourceVersion}
        sourceHash={sourceHash}
        uploadState={uploadState}
        uploadProgress={uploadProgress}
        uploadDetailsOpen={uploadDetailsOpen}
        uploadError={uploadError}
        fileRef={fileRef}
        chooseSource={chooseSource}
        cancelUpload={cancelUpload}
        onToggleUploadDetails={() =>
          setUploadDetailsOpen((value) => !value)
        }
        tools={workspaceTools}
        activeTool={activeTool}
        toolCollapsed={toolCollapsed}
        onToolCollapsedChange={setToolCollapsed}
        onUseTool={useTool}
        zoom={zoom}
        previewBackground={previewBackground}
        previewQuality={previewQuality}
        grid={grid}
        safeBounds={safeBounds}
        solo={solo}
        focusMode={focusMode}
        onZoomChange={setZoom}
        onPreviewBackgroundChange={setPreviewBackground}
        onPreviewQualityChange={setPreviewQuality}
        onGridChange={setGrid}
        onSafeBoundsChange={setSafeBounds}
        onSoloChange={setSolo}
        onFocusModeChange={setFocusMode}
        imageLayers={imageLayers}
        bookLayers={bookLayers}
        layers={layers}
        hiddenLayers={hiddenLayers}
        selectedIds={selectedIds}
        activeLayerId={activeLayerId}
        onSelectLayer={(id) => {
          setActiveLayerId(id);
          setSelectedIds([id]);
        }}
        onLayerSelectionChange={(ids, activeId) => {
          setSelectedIds(ids);
          setActiveLayerId(activeId);
        }}
        onLayersChange={setLayers}
        layersCollapsed={layersCollapsed}
        layerWidth={layerWidth}
        layerLoading={layerLoading}
        onLayersCollapsedChange={setLayersCollapsed}
        onLayerWidthChange={setLayerWidth}
        onArrangeReadingOrder={arrangeReadingOrder}
        guidanceRevision={guidanceRevision}
        imagePreparation={imagePreparation}
        ocrReview={ocrReview}
        imageCanvasSize={imageCanvasSize}
        sourcePreviewUrl={sourcePreviewUrl}
        pdfMode={pdfMode}
        pdfPages={pdfPages}
        activePdfPage={activePdfPage}
        pdfPageCount={pdfPageCount}
        pdfPageSize={pdfPageSize}
        processing={processing}
        editorCommand={editorCommand}
        onApplyImageGuide={applyImageGuide}
        onApplyPdfGuide={applyPdfGuide}
        onHistoryNavigate={navigateDocumentHistory}
        onPdfSegmentationChange={changePdfSegmentation}
        onPdfPageChange={(page, size) => {
          setActivePdfPage(page);
          setPdfPageSize(size);
        }}
        onConfirm={requestConfirmation}
        onToolSelect={selectEditorTool}
        onRequireAuth={onRequireAuth}
        onNotify={onNotify}
      />

      <WorkspaceStatusBar
        saveState={saveState}
        persistedSource={persistedSource}
        sourceVersion={sourceVersion}
        processing={processing}
        mode={mode}
        zoom={zoom}
        {...(activeLayer?.name ? { activeLayerName: activeLayer.name } : {})}
        {...(imageCanvasSize ? { imageCanvasSize } : {})}
        {...(mode === "book" && pdfPageSize
          ? { pdfPageSize }
          : {})}
      />

      <WorkspaceDialogs
        mode={mode}
        maxUploadBytes={capabilities.limits.maxUploadBytes}
        persistedSource={persistedSource}
        projectId={projectId}
        sourceVersionId={sourceVersionId}
        sourceVersionsOpen={sourceVersionsOpen}
        onCloseSourceVersions={() => setSourceVersionsOpen(false)}
        onRestoreSourceVersion={restoreSourceVersion}
        mobilePanel={mobilePanel}
        onMobilePanelChange={setMobilePanel}
        onExport={openExportReview}
        tools={workspaceTools}
        activeTool={activeTool}
        layers={layers}
        selectedIds={selectedIds}
        activeLayerId={activeLayerId}
        layerCheckSummary={layerCheckSummary}
        onUseTool={useTool}
        onSelectLayer={(id) => {
          setActiveLayerId(id);
          setSelectedIds([id]);
        }}
        pdfTextOperation={pdfTextOperation}
        onClosePdfTextOperation={() => setPdfTextOperation(undefined)}
        onApplyPdfTextOperation={applyPdfTextOperation}
        bookLayers={bookLayers}
        pdfRegionOcrLayer={pdfRegionOcrLayer}
        pdfRegionOcrPageSize={pdfRegionOcrPageSize}
        onClosePdfRegionOcr={() => setPdfRegionOcrLayerId(undefined)}
        onApplyPdfRegionOcr={applyPdfRegionOcr}
        imageRasterOperation={imageRasterOperation}
        imageLayers={imageLayers}
        onCloseImageRasterOperation={() =>
          setImageRasterOperation(undefined)
        }
        onApplyImageRasterOperation={applyImageRasterOperation}
        exportOpen={exportOpen}
        onCloseExport={() => setExportOpen(false)}
        exportReturnFocusTo={exportTriggerRef.current}
        saveState={saveState}
        onRetrySave={async () => {
          await flushLayerReview();
        }}
        imageCanvasSize={imageCanvasSize}
        pdfPages={pdfPages}
        sourcePreviewUrl={sourcePreviewUrl}
        onLayersChange={setLayers}
        onCreateExport={createExport}
        onNotify={onNotify}
      />
      <ShortcutsModal open={shortcutsOpen} onClose={closeShortcuts} />
      {confirmationDialog}
    </div>
  );
}
