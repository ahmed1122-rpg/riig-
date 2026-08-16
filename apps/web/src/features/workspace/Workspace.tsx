import { useCallback, useRef, useState } from "react";
import { useConfirmation } from "../../shared/useConfirmation";
import { ShortcutsModal } from "../../shared/ShortcutsModal";
import type { Layer, ProjectMode } from "../../types";
import type { LayerDocumentCommand } from "@motionprep/contracts";
import {
  WorkspaceHeader,
  WorkspacePipeline,
  WorkspaceStatusBar,
} from "./WorkspaceChrome";
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
import { useWorkspaceLayerNavigation } from "./useWorkspaceLayerNavigation";
import {
  useWorkspaceEditorState,
  useWorkspaceReviewState,
  useWorkspaceSourceState,
} from "./useWorkspaceStateControllers";
import { useDocumentCommandCoordinator } from "./useDocumentCommandCoordinator";
import { getWorkspaceMaxUploadBytes, useWorkspaceDerivedState } from "./useWorkspaceDerivedState";
import { useWorkspaceRevisionConflict } from "./useWorkspaceRevisionConflict";

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
  const maxUploadBytes = getWorkspaceMaxUploadBytes(mode, capabilities.limits);
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
  const layerCommandRef = useRef<
    (command: LayerDocumentCommand) => Promise<void>
  >(async () => undefined);
  const { requestConfirmation, confirmationDialog } = useConfirmation();
  const [editorDraftDirty, setEditorDraftDirty] = useState(false);
  const { shortcutsOpen, closeShortcuts } = useWorkspaceShortcutHelp();

  const { navigateWorkspacePdfPage, selectWorkspaceLayer } =
    useWorkspaceLayerNavigation({
      mode,
      layers,
      pdfPages,
      activePdfPage,
      editorDraftDirty,
      requestConfirmation,
      setActivePdfPage,
      setPdfPageSize,
      setEditorDraftDirty,
      setSelectedIds,
      setActiveLayerId,
    });

  const toolController = useWorkspaceToolController({
    mode,
    persistedSource,
    features: capabilities.features,
    activeLayer,
    selectedIds,
    imageLayers,
    bookLayers,
    onArrangeReadingOrder: () => {
      void layerCommandRef.current({
        kind: "arrange-reading-order",
        scope: { kind: "document" },
        order: "reading",
      }).catch((error: unknown) => {
        onNotify(error instanceof Error ? error.message : "تعذر ترتيب القراءة.");
      });
    },
    onNotify,
  });
  const {
    imageRasterOperation,
    pdfRegionOcrLayerId,
    pdfTextOperation,
    resetToolState,
  } = toolController;
  const handleRevisionConflict = useWorkspaceRevisionConflict(
    requestConfirmation,
    onNotify,
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
  const commandCoordinator = useDocumentCommandCoordinator({
    ...(projectId ? { projectId } : {}),
    ...(sourceVersionId ? { sourceVersionId } : {}),
    flushLayerReview,
    saveInFlightRef,
  });
  useWorkspaceNavigationGuard({
    hasUnsavedReview,
    flushLayerReview,
    hasUnsavedDraft: () => editorDraftDirty,
    confirmDiscardDraft: () =>
      requestConfirmation({
        title: "تجاهل مسودة الإرشاد؟",
        description:
          mode === "book"
            ? "توجد مناطق PDF لم تُطبّق. سيؤدي التنقل إلى فقدها."
            : "توجد إشارات رسم لم تُطبّق. سيؤدي التنقل إلى فقدها.",
        confirmLabel: "تجاهل المسودة والمتابعة",
        tone: "danger",
      }),
    onNavigationGuardChange,
    onNotify,
  });
  const {
    pdfRegionOcrLayer,
    pdfRegionOcrPageSize,
    layerCheckSummary,
    hiddenLayers,
    pipeline,
  } = useWorkspaceDerivedState(
    mode,
    layers,
    imageLayers,
    bookLayers,
    pdfPages,
    pdfRegionOcrLayerId,
    solo,
    activeLayerId,
    sourceVersion,
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
    maxUploadBytes,
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
    commandCoordinator,
    hasUnsavedEditorDraft: editorDraftDirty,
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
    applyLayerCommand,
    applyPdfGuide,
    applyPdfRegionOcr,
    applyPdfTextOperation,
    changePdfSegmentation,
    commandStatus,
    createExport,
    documentChangeLog,
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
    layers,
    ...(layerDocumentRevision === undefined
      ? {}
      : { layerDocumentRevision }),
    pdfTextOperation,
    imageRasterOperation,
    pdfRegionOcrLayer,
    pdfRegionOcrPageSize,
    commandCoordinator,
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
  layerCommandRef.current = applyLayerCommand;

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
          maxUploadBytes,
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
          onSelectLayer: selectWorkspaceLayer,
          onPdfPageChange: navigateWorkspacePdfPage,
          onLayerCommand: applyLayerCommand,
          documentChangeLog,
          layerCheckSummary,
          onDraftDirtyChange: setEditorDraftDirty,
        }}
      />

      <WorkspaceStatusBar
        saveState={saveState}
        persistedSource={persistedSource}
        sourceVersion={sourceVersion}
        processing={processing}
        commandStatus={commandStatus}
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
          maxUploadBytes,
          onNotify,
        }}
        source={source}
        review={review}
        editor={editor}
        tools={toolController}
        actions={{
          onRestoreSourceVersion: restoreSourceVersion,
          onExecuteRestore: (restore) =>
            commandCoordinator.run(async ({ signal }) => restore(signal), {
              allowIdentityChange: true,
            }),
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
          onSelectLayer: selectWorkspaceLayer,
          onPdfPageChange: navigateWorkspacePdfPage,
          onLayerCommand: applyLayerCommand,
          documentChangeLog,
        }}
      />
      <ShortcutsModal open={shortcutsOpen} onClose={closeShortcuts} />
      {confirmationDialog}
    </div>
  );
}
