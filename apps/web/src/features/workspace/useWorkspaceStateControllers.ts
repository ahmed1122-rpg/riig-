import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Layer, PdfSegmentation, ProjectMode } from "../../types";
import type { LayerDocumentView } from "../../lib/api";
import type { PreviewBackground } from "./PreviewToolbar";
import type { UploadState } from "./SourceUploadStatus";
import type { WorkspaceSaveState } from "./WorkspaceChrome";
import type { WorkspaceMobilePanel } from "./workspaceMobilePanel";
import { storedPdfSegmentation } from "../../shared/pdfSegmentation";
import { useStoredPreference } from "../../shared/useStoredPreference";
import {
  firstEditableWorkspaceLayer,
  firstEditableWorkspaceLayerId,
} from "./workspaceLayerSelection";

function emptySourceName(mode: ProjectMode): string {
  return mode === "image" ? "اختر صورة واحدة" : "اختر ملف PDF واحدًا";
}

export function useWorkspaceReviewState(mode: ProjectMode) {
  const [imageLayers, setImageLayers] = useState<Layer[]>([]);
  const [bookLayers, setBookLayers] = useState<Layer[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeLayerId, setActiveLayerId] = useState("");
  const [layerDocumentRevision, setLayerDocumentRevision] = useState<number>();
  const [saveState, setSaveState] =
    useState<WorkspaceSaveState>("unavailable");

  const layers = mode === "image" ? imageLayers : bookLayers;
  const setLayers = mode === "image" ? setImageLayers : setBookLayers;
  const activeLayer = useMemo(
    () =>
      layers.find(
        (layer) => layer.id === activeLayerId && layer.kind !== "group",
      ) ?? firstEditableWorkspaceLayer(layers),
    [activeLayerId, layers],
  );

  const resetSelection = useCallback((preparedLayers: readonly Layer[]) => {
    const firstLayerId = firstEditableWorkspaceLayerId(preparedLayers);
    setActiveLayerId(firstLayerId);
    setSelectedIds(firstLayerId ? [firstLayerId] : []);
  }, []);

  const prepareMode = useCallback(
    (nextMode: ProjectMode) => {
      const nextLayers = nextMode === "image" ? imageLayers : bookLayers;
      resetSelection(nextLayers);
    },
    [bookLayers, imageLayers, resetSelection],
  );

  const selectLayer = useCallback((id: string) => {
    setActiveLayerId(id);
    setSelectedIds([id]);
  }, []);

  const changeSelection = useCallback((ids: string[], activeId: string) => {
    setSelectedIds(ids);
    setActiveLayerId(activeId);
  }, []);

  return {
    imageLayers,
    setImageLayers,
    bookLayers,
    setBookLayers,
    layers,
    setLayers,
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
    selectLayer,
    changeSelection,
  };
}

export function useWorkspaceSourceState(mode: ProjectMode) {
  const [processing, setProcessing] = useState(false);
  const [sourceName, setSourceName] = useState(() => emptySourceName(mode));
  const [sourceVersion, setSourceVersion] = useState(0);
  const [uploadState, setUploadState] = useState<UploadState>("empty");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string>();
  const [uploadDetailsOpen, setUploadDetailsOpen] = useState(false);
  const [projectId, setProjectId] = useState<string>();
  const [sourceVersionId, setSourceVersionId] = useState<string>();
  const [pendingUploadId, setPendingUploadId] = useState<string>();
  const [pendingSourceVersionId, setPendingSourceVersionId] = useState<string>();
  const [processingJobId, setProcessingJobId] = useState<string>();
  const [sourceHash, setSourceHash] = useState<string>();
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string>();
  const [imageCanvasSize, setImageCanvasSize] = useState<{
    width: number;
    height: number;
  }>();
  const [imagePreparation, setImagePreparation] =
    useState<LayerDocumentView["imagePreparation"]>();
  const [ocrReview, setOcrReview] =
    useState<LayerDocumentView["ocrReview"]>();
  const [guidanceRevision, setGuidanceRevision] = useState(0);
  const [pdfPageSize, setPdfPageSize] = useState<{
    width: number;
    height: number;
  }>();
  const [pdfPages, setPdfPages] = useState<
    Array<{ pageNumber: number; width: number; height: number }>
  >([]);
  const [activePdfPage, setActivePdfPage] = useState(1);
  const [pdfPageCount, setPdfPageCount] = useState(1);

  const persistedSource = Boolean(projectId && sourceVersionId);

  const resetForMode = useCallback((nextMode: ProjectMode) => {
    setProcessing(false);
    setSourceName(emptySourceName(nextMode));
    setSourceVersion(0);
    setUploadState("empty");
    setUploadProgress(0);
    setUploadError(undefined);
    setUploadDetailsOpen(false);
    setProjectId(undefined);
    setSourceVersionId(undefined);
    setPendingUploadId(undefined);
    setPendingSourceVersionId(undefined);
    setProcessingJobId(undefined);
    setSourceHash(undefined);
    setSourcePreviewUrl(undefined);
    setImageCanvasSize(undefined);
    setImagePreparation(undefined);
    setOcrReview(undefined);
    setGuidanceRevision(0);
    setPdfPageSize(undefined);
    setPdfPages([]);
    setActivePdfPage(1);
    setPdfPageCount(1);
  }, []);

  return {
    processing,
    setProcessing,
    sourceName,
    setSourceName,
    sourceVersion,
    setSourceVersion,
    uploadState,
    setUploadState,
    uploadProgress,
    setUploadProgress,
    uploadError,
    setUploadError,
    uploadDetailsOpen,
    setUploadDetailsOpen,
    projectId,
    setProjectId,
    sourceVersionId,
    setSourceVersionId,
    pendingUploadId,
    setPendingUploadId,
    pendingSourceVersionId,
    setPendingSourceVersionId,
    processingJobId,
    setProcessingJobId,
    sourceHash,
    setSourceHash,
    sourcePreviewUrl,
    setSourcePreviewUrl,
    imageCanvasSize,
    setImageCanvasSize,
    imagePreparation,
    setImagePreparation,
    ocrReview,
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
    resetForMode,
  };
}

export function useWorkspaceEditorState(mode: ProjectMode) {
  const [mobilePanel, setMobilePanel] =
    useState<WorkspaceMobilePanel>("none");
  const [pdfMode, setPdfMode] =
    useState<PdfSegmentation>(storedPdfSegmentation);
  const [exportOpen, setExportOpen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [previewBackground, setPreviewBackground] =
    useState<PreviewBackground>(mode === "image" ? "dark" : "white");
  const [grid, setGrid] = useState(true);
  const [safeBounds, setSafeBounds] = useState(true);
  const [solo, setSolo] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [layerLoading, setLayerLoading] = useState(false);
  const [toolCollapsed, setToolCollapsed] = useStoredPreference(
    "motionprep.workspace.tools-collapsed",
    false,
  );
  const [layersCollapsed, setLayersCollapsed] = useStoredPreference(
    "motionprep.workspace.layers-collapsed",
    false,
  );
  const [layerWidth, setLayerWidth] = useStoredPreference(
    "motionprep.workspace.layers-width",
    326,
    (value): value is number =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 260 &&
      value <= 430,
  );

  useEffect(() => {
    setLayerLoading(true);
    const timer = window.setTimeout(() => setLayerLoading(false), 260);
    return () => window.clearTimeout(timer);
  }, [mode]);

  const resetForMode = useCallback((nextMode: ProjectMode) => {
    setMobilePanel("none");
    setExportOpen(false);
    setPreviewBackground(nextMode === "image" ? "dark" : "white");
    setSolo(false);
    setFocusMode(false);
  }, []);

  return {
    mobilePanel,
    setMobilePanel,
    pdfMode,
    setPdfMode,
    exportOpen,
    setExportOpen,
    zoom,
    setZoom,
    previewBackground,
    setPreviewBackground,
    grid,
    setGrid,
    safeBounds,
    setSafeBounds,
    solo,
    setSolo,
    focusMode,
    setFocusMode,
    layerLoading,
    toolCollapsed,
    setToolCollapsed,
    layersCollapsed,
    setLayersCollapsed,
    layerWidth,
    setLayerWidth,
    resetForMode,
  };
}

export type WorkspaceReviewState = ReturnType<typeof useWorkspaceReviewState>;
export type WorkspaceSourceState = ReturnType<typeof useWorkspaceSourceState>;
export type WorkspaceEditorState = ReturnType<typeof useWorkspaceEditorState>;
