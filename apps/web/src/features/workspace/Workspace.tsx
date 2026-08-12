import { useCallback, useMemo, useRef } from "react";
import { useConfirmation } from "../../shared/useConfirmation";
import { ShortcutsModal } from "../../shared/ShortcutsModal";
import type { Layer, ProjectMode } from "../../types";
import {
  WorkspaceHeader,
  WorkspacePipeline,
  WorkspaceStatusBar,
} from "./WorkspaceChrome";
import { getLayerCheckSummary } from "./layerChecks";
import { getWorkspacePipeline } from "./workspacePresentation";
import { isWorkspaceRevisionConflict } from "./workspaceConflict";
import { useWorkspaceReviewAutosave } from "./useWorkspaceReviewAutosave";
import { useWorkspaceToolController } from "./useWorkspaceToolController";
import { WorkspaceEditorLayout } from "./WorkspaceEditorLayout";
import { WorkspaceDialogs } from "./WorkspaceDialogs";
import { useWorkspaceProjectLifecycle } from "./useWorkspaceProjectLifecycle";
import { useWorkspaceCommands } from "./useWorkspaceCommands";
import { useWorkspaceNavigationGuard } from "./useWorkspaceNavigationGuard";
import { useWorkspaceShortcutHelp } from "./useWorkspaceShortcutHelp";
import type { WorkspaceProps } from "./Workspace.types";
import { commitWorkspaceModeChange } from "./workspaceModeChange";
import {
  useWorkspaceEditorState,
  useWorkspaceReviewState,
  useWorkspaceSourceState,
} from "./useWorkspaceStateControllers";

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
  const review = useWorkspaceReviewState(mode);
  const source = useWorkspaceSourceState(mode);
  const editor = useWorkspaceEditorState(mode);
  const {
    imageLayers,
    setImageLayers,
    bookLayers,
    setBookLayers,
    layers,
    selectedIds,
    setSelectedIds,
    activeLayerId,
    setActiveLayerId,
    activeLayer,
    layerDocumentRevision,
    setLayerDocumentRevision,
    saveState,
    setSaveState,
    resetSelection,
    prepareMode,
  } = review;
  const {
    processing,
    setProcessing,
    sourceName,
    setSourceName,
    sourceVersion,
    setSourceVersion,
    setUploadState,
    setUploadProgress,
    setUploadError,
    setUploadDetailsOpen,
    projectId,
    setProjectId,
    sourceVersionId,
    setSourceVersionId,
    setPendingUploadId,
    setPendingSourceVersionId,
    setProcessingJobId,
    setSourceHash,
    sourcePreviewUrl,
    setSourcePreviewUrl,
    imageCanvasSize,
    setImageCanvasSize,
    setImagePreparation,
    setOcrReview,
    guidanceRevision,
    setGuidanceRevision,
    pdfPageSize,
    setPdfPageSize,
    pdfPages,
    setPdfPages,
    activePdfPage,
    setActivePdfPage,
    pdfPageCount,
    setPdfPageCount,
    persistedSource,
  } = source;
  const {
    pdfMode,
    setPdfMode,
    setExportOpen,
    zoom,
    solo,
    focusMode,
    toolCollapsed,
    layersCollapsed,
    layerWidth,
  } = editor;
  const fileRef = useRef<HTMLInputElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement | null>(null);
  const { requestConfirmation, confirmationDialog } = useConfirmation();
  const { shortcutsOpen, closeShortcuts } = useWorkspaceShortcutHelp();

  const toolController = useWorkspaceToolController({
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
  const {
    imageRasterOperation,
    pdfRegionOcrLayerId,
    pdfTextOperation,
    resetToolState,
  } = toolController;
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
      resetSelection(preparedLayers);
      resetToolState(mode);
    },
    [mode, resetSelection, resetToolState],
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
    setPendingUploadId,
    setPendingSourceVersionId,
    setProcessingJobId,
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

  const switchMode = async (nextMode: ProjectMode): Promise<void> => {
    await commitWorkspaceModeChange(
      mode,
      nextMode,
      onModeChange,
      (committedMode) => {
        replaceLayerAssetUrls([]);
        prepareMode(committedMode);
        resetToolState(committedMode);
        source.resetForMode(committedMode);
        editor.resetForMode(committedMode);
        resetSavedReview();
      },
    );
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
        context={{
          mode,
          authenticated,
          maxUploadBytes: capabilities.limits.maxUploadBytes,
          onRequireAuth,
          onNotify,
        }}
        source={source}
        review={review}
        editor={editor}
        tools={toolController}
        actions={{
          fileRef,
          chooseSource,
          cancelUpload,
          hiddenLayers,
          onApplyImageGuide: applyImageGuide,
          onApplyPdfGuide: applyPdfGuide,
          onHistoryNavigate: navigateDocumentHistory,
          onPdfSegmentationChange: changePdfSegmentation,
          onConfirm: requestConfirmation,
        }}
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
        context={{
          mode,
          maxUploadBytes: capabilities.limits.maxUploadBytes,
          onNotify,
        }}
        source={source}
        review={review}
        editor={editor}
        tools={toolController}
        actions={{
          onRestoreSourceVersion: restoreSourceVersion,
          onExport: openExportReview,
          layerCheckSummary,
          onApplyPdfTextOperation: applyPdfTextOperation,
          pdfRegionOcrLayer,
          pdfRegionOcrPageSize,
          onApplyPdfRegionOcr: applyPdfRegionOcr,
          onApplyImageRasterOperation: applyImageRasterOperation,
          exportReturnFocusTo: exportTriggerRef.current,
          onRetrySave: async () => {
            await flushLayerReview();
          },
          onCreateExport: createExport,
        }}
      />
      <ShortcutsModal open={shortcutsOpen} onClose={closeShortcuts} />
      {confirmationDialog}
    </div>
  );
}
