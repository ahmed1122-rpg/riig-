import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../shared/Icon";
import { useConfirmation } from "../../shared/useConfirmation";
import type { Layer, PdfSegmentation, ProjectMode } from "../../types";
import { ExportReview } from "./ExportReview";
import { ImageGuidanceEditor, PdfGuidanceEditor } from "./GuidedEditors";
import { LayerDock } from "./LayerDock";
import { PreviewToolbar, type PreviewBackground, type PreviewQuality } from "./PreviewToolbar";
import { SourceUploadStatus, type UploadState } from "./SourceUploadStatus";
import { WorkspaceToolRail } from "./WorkspaceToolRail";
import { SourceVersionHistoryDialog } from "./SourceVersionHistoryDialog";
import { PdfTextOperationDialog } from "./PdfTextOperationDialog";
import { ImageRasterOperationDialog } from "./ImageRasterOperationDialog";
import { PdfRegionOcrDialog } from "./PdfRegionOcrDialog";
import {
  WorkspaceHeader,
  WorkspaceMobileDock,
  WorkspaceMobileSheet,
  WorkspacePipeline,
  WorkspaceStatusBar,
  type WorkspaceMobilePanel,
  type WorkspaceSaveState,
} from "./WorkspaceChrome";
import {
  EmptyLayerDock,
  EmptySourcePreview,
} from "./WorkspaceEmptyStates";
import { useWorkspacePreference } from "./useWorkspacePreference";
import { useWorkspaceUpload } from "./useWorkspaceUpload";
import { getLayerCheckSummary } from "./layerChecks";
import {
  pdfApiModes,
  pdfSegmentationLabels,
  storedPdfSegmentation,
} from "./pdfSegmentation";
import {
  arrangeLayersForReading,
} from "./layerReviewState";
import {
  getReadyWorkspaceTools,
  isEditableShortcutTarget,
  isWorkspaceShortcut,
  resolveWorkspaceToolDispatch,
  type ReadyWorkspaceToolId,
  type ResolvedWorkspaceTool,
  type WorkspaceEditorCommand,
} from "./workspaceToolRegistry";
import {
  loadRasterLayerPreviews,
  loadWorkspaceProjectDocument,
  storedPreviewQuality,
  toWorkspaceLayers,
} from "./workspaceDocument";
import {
  createImageGuidedRefinementInput,
  createPdfGuidedRefinementInput,
  type GuidedRefinementContext,
  type GuidedRefinementInput,
  type ImageGuideInput,
  type PdfGuideInput,
} from "./workspaceGuidance";
import {
  getWorkspacePipeline,
} from "./workspacePresentation";
import { isWorkspaceRevisionConflict } from "./workspaceConflict";
import type { ApplicationCapabilities, ExportFormat } from "@motionprep/contracts";
import {
  ApiError,
  applyGuidedRefinement,
  createExportArtifact,
  mergePdfTextLayers,
  mergeImageLayers,
  navigateLayerDocumentHistory,
  reanalyzePdfSource,
  refineImageLayerEdges,
  runPdfRegionOcr,
  splitPdfTextLayer,
  type LayerDocumentView,
  type ProjectSummary,
} from "../../lib/api";
import { useWorkspaceReviewAutosave } from "./useWorkspaceReviewAutosave";

interface WorkspaceProps {
  mode: ProjectMode;
  capabilities: ApplicationCapabilities;
  onModeChange: (mode: ProjectMode) => void;
  onBack: () => void;
  onNavigationGuardChange: (
    guard: (() => Promise<boolean>) | null,
  ) => void;
  onNotify: (message: string) => void;
  authenticated: boolean;
  onRequireAuth: () => void;
  initialProject: Pick<
    ProjectSummary,
    | "id"
    | "name"
    | "currentSourceVersionId"
    | "currentSourceVersionNumber"
  > | null;
}

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
  const [activeTool, setActiveTool] = useState<ReadyWorkspaceToolId>(
    mode === "image" ? "image.keep" : "pdf.line",
  );
  const [editorCommand, setEditorCommand] = useState<WorkspaceEditorCommand>();
  const [mobilePanel, setMobilePanel] =
    useState<WorkspaceMobilePanel>("none");
  const [pdfMode, setPdfMode] = useState<PdfSegmentation>(
    storedPdfSegmentation,
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [sourceVersionsOpen, setSourceVersionsOpen] = useState(false);
  const [pdfTextOperation, setPdfTextOperation] = useState<{
    operation: "split" | "merge";
    layerIds: string[];
  }>();
  const [pdfRegionOcrLayerId, setPdfRegionOcrLayerId] = useState<string>();
  const [imageRasterOperation, setImageRasterOperation] = useState<{
    operation: "edge-refine" | "merge";
    layerIds: string[];
  }>();
  const [zoom, setZoom] = useState(100);
  const [previewBackground, setPreviewBackground] = useState<PreviewBackground>(mode === "image" ? "dark" : "white");
  const [previewQuality, setPreviewQuality] =
    useState<PreviewQuality>(storedPreviewQuality);
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
  const [imagePreparation, setImagePreparation] =
    useState<LayerDocumentView["imagePreparation"]>();
  const [ocrReview, setOcrReview] =
    useState<LayerDocumentView["ocrReview"]>();
  const [layerDocumentRevision, setLayerDocumentRevision] =
    useState<number>();
  const [guidanceRevision, setGuidanceRevision] = useState(0);
  const [saveState, setSaveState] =
    useState<WorkspaceSaveState>("idle");
  const [pdfPageSize, setPdfPageSize] = useState<{
    width: number;
    height: number;
  }>();
  const [pdfPages, setPdfPages] = useState<
    Array<{ pageNumber: number; width: number; height: number }>
  >([]);
  const [activePdfPage, setActivePdfPage] = useState(1);
  const [pdfPageCount, setPdfPageCount] = useState(1);
  const [toolCollapsed, setToolCollapsed] = useWorkspacePreference("motionprep.workspace.tools-collapsed", false);
  const [layersCollapsed, setLayersCollapsed] = useWorkspacePreference("motionprep.workspace.layers-collapsed", false);
  const [layerWidth, setLayerWidth] = useWorkspacePreference("motionprep.workspace.layers-width", 326);
  const fileRef = useRef<HTMLInputElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement | null>(null);
  const commandSequenceRef = useRef(0);
  const layerAssetUrlsRef = useRef<string[]>([]);
  const { requestConfirmation, confirmationDialog } = useConfirmation();

  const layers = mode === "image" ? imageLayers : bookLayers;
  const setLayers = mode === "image" ? setImageLayers : setBookLayers;
  const activeLayer = useMemo(() => layers.find((layer) => layer.id === activeLayerId) ?? layers[0], [activeLayerId, layers]);
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
  const persistedSource = Boolean(projectId && sourceVersionId);
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
  const allowWorkspaceNavigation = useCallback(async () => {
    if (!hasUnsavedReview()) return true;
    try {
      await flushLayerReview();
      return true;
    } catch {
      onNotify(
        "تعذر حفظ آخر تعديل؛ أُوقف التنقل لحماية عملك. أعد المحاولة بعد استقرار الاتصال.",
      );
      return false;
    }
  }, [flushLayerReview, hasUnsavedReview, onNotify]);

  useEffect(() => {
    onNavigationGuardChange(allowWorkspaceNavigation);
    return () => onNavigationGuardChange(null);
  }, [allowWorkspaceNavigation, onNavigationGuardChange]);
  const workspaceTools = useMemo(
    () => getReadyWorkspaceTools(mode, persistedSource, capabilities.features),
    [capabilities.features, mode, persistedSource],
  );
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
      setActiveTool(mode === "image" ? "image.keep" : "pdf.line");
      setEditorCommand(undefined);
    },
    [mode],
  );
  const replaceLayerAssetUrls = useCallback((urls: string[]) => {
    for (const url of layerAssetUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    layerAssetUrlsRef.current = urls;
  }, []);
  const applyPreparedDocument = useCallback(
    (
      document: LayerDocumentView,
      preparedLayers: Layer[],
      pdfPageNumber?: number,
    ) => {
      if (mode === "image") {
        setImageLayers(preparedLayers);
        setImageCanvasSize({
          width: document.width,
          height: document.height,
        });
        setImagePreparation(document.imagePreparation);
        setOcrReview(undefined);
        return;
      }
      setBookLayers(preparedLayers);
      setOcrReview(document.ocrReview);
      setPdfPages(document.pages ?? []);
      const page = pdfPageNumber === undefined
        ? document.pages?.[0]
        : (
            document.pages?.find(
              (candidate) =>
                candidate.pageNumber === pdfPageNumber,
            ) ?? document.pages?.[0]
          );
      setActivePdfPage(page?.pageNumber ?? 1);
      setPdfPageSize(
        page
          ? { width: page.width, height: page.height }
          : { width: document.width, height: document.height },
      );
      setPdfPageCount(document.pages?.length ?? 1);
    },
    [mode],
  );
  const { chooseSource, cancelUpload } = useWorkspaceUpload({
    mode,
    authenticated,
    persistedSource,
    sourceName,
    ...(projectId ? { projectId } : {}),
    pdfMode,
    onRequireAuth,
    onNotify,
    confirmSourceReplacement: requestConfirmation,
    onLayerAssetUrls: replaceLayerAssetUrls,
    onDocumentReady: (file, result, preparedLayers) => {
      setProjectId(result.projectId);
      setSourceVersionId(result.sourceVersionId);
      setSourceHash(result.sha256);
      applyPreparedDocument(result.document, preparedLayers);
      resetLayerSelection(preparedLayers);
      setSourcePreviewUrl(URL.createObjectURL(file));
      adoptSavedReview(preparedLayers, result.document.revision ?? 1);
      setGuidanceRevision(
        result.document.guidance?.revision ?? 0,
      );
      setSourceVersion(result.sourceVersionNumber);
    },
    setSourceName,
    setUploadState,
    setUploadProgress,
    setUploadError,
    setUploadDetailsOpen,
  });

  useEffect(() => () => {
    for (const url of layerAssetUrlsRef.current) URL.revokeObjectURL(url);
  }, []);

  useEffect(
    () => () => {
      if (sourcePreviewUrl) URL.revokeObjectURL(sourcePreviewUrl);
    },
    [sourcePreviewUrl],
  );

  useEffect(() => {
    if (!initialProject || !authenticated) return;
    const controller = new AbortController();
    setUploadState("verifying");
    setUploadProgress(0);
    setUploadError(undefined);
    setSourceName(initialProject.name);
    setProjectId(initialProject.id);

    void loadWorkspaceProjectDocument(
      initialProject,
      mode,
      controller.signal,
    )
      .then(({ document, preparedLayers, previewUrls }) => {
        if (controller.signal.aborted) return;
        replaceLayerAssetUrls(previewUrls);
        setSourceVersionId(document.sourceVersionId);
        adoptSavedReview(preparedLayers, document.revision ?? 1);
        setGuidanceRevision(document.guidance?.revision ?? 0);
        setSourceVersion(initialProject.currentSourceVersionNumber ?? 1);
        setUploadState("ready");
        setUploadProgress(100);
        applyPreparedDocument(document, preparedLayers);
        resetLayerSelection(preparedLayers);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setUploadState("error");
        setUploadProgress(0);
        setUploadError(
          caught instanceof ApiError
            ? caught.message
            : "تعذر فتح وثيقة الطبقات لهذا المشروع.",
        );
        setUploadDetailsOpen(true);
      });
    return () => controller.abort();
  }, [
    applyPreparedDocument,
    adoptSavedReview,
    authenticated,
    initialProject,
    mode,
    replaceLayerAssetUrls,
    resetLayerSelection,
  ]);

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
    setActiveTool(nextMode === "image" ? "image.keep" : "pdf.line");
    setEditorCommand(undefined);
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

  const arrangeReadingOrder = useCallback(() => {
    if (!persistedSource || mode !== "book") {
      onNotify("ارفع ملف PDF وجهّزه قبل ترتيب القراءة.");
      return;
    }
    setBookLayers((current) => arrangeLayersForReading(current));
    onNotify("تم ترتيب القراءة حسب الصفحة والموضع، وسيُحفظ تلقائيًا.");
  }, [mode, onNotify, persistedSource]);

  const useTool = useCallback((tool: ResolvedWorkspaceTool) => {
    const dispatch = resolveWorkspaceToolDispatch(tool);
    if (dispatch.kind === "unavailable") {
      onNotify(dispatch.reason);
      return;
    }
    if (dispatch.kind === "reading-order") {
      arrangeReadingOrder();
      return;
    }
    if (dispatch.kind === "source-versions") {
      setSourceVersionsOpen(true);
      return;
    }
    if (dispatch.kind === "pdf-region-ocr") {
      if (
        !activeLayer ||
        activeLayer.kind !== "text" ||
        activeLayer.locked ||
        !activeLayer.bounds ||
        activeLayer.pageNumber === undefined
      ) {
        onNotify("اختر طبقة نصية غير مقفلة ولها حدود على صفحة PDF قبل تشغيل OCR الإقليمي.");
        return;
      }
      setPdfRegionOcrLayerId(activeLayer.id);
      return;
    }
    if (dispatch.kind === "pdf-split") {
      if (
        !activeLayer ||
        activeLayer.kind !== "text" ||
        activeLayer.locked ||
        !activeLayer.fullContent ||
        Array.from(activeLayer.fullContent).length < 2
      ) {
        onNotify("اختر وحدة نصية غير مقفلة تحتوي حرفين على الأقل قبل التقسيم.");
        return;
      }
      setPdfTextOperation({ operation: "split", layerIds: [activeLayer.id] });
      return;
    }
    if (dispatch.kind === "pdf-merge") {
      const selected = bookLayers.filter((layer) => selectedIds.includes(layer.id));
      if (
        selected.length < 2 ||
        selected.length !== selectedIds.length ||
        selected.some(
          (layer) =>
            layer.kind !== "text" || layer.locked || !layer.fullContent,
        )
      ) {
        onNotify("اختر طبقتين نصيتين غير مقفلتين على الأقل قبل الدمج.");
        return;
      }
      setPdfTextOperation({
        operation: "merge",
        layerIds: selected.map((layer) => layer.id),
      });
      return;
    }
    if (dispatch.kind === "image-edge-refine") {
      if (
        !activeLayer ||
        activeLayer.kind !== "body" ||
        activeLayer.locked
      ) {
        onNotify("اختر طبقة Raster غير مقفلة قبل تحسين الحواف.");
        return;
      }
      setImageRasterOperation({
        operation: "edge-refine",
        layerIds: [activeLayer.id],
      });
      return;
    }
    if (dispatch.kind === "image-merge") {
      const selected = imageLayers.filter((layer) =>
        selectedIds.includes(layer.id),
      );
      if (
        selected.length < 2 ||
        selected.length !== selectedIds.length ||
        selected.some(
          (layer) =>
            layer.kind !== "body" || layer.locked || !layer.visible,
        )
      ) {
        onNotify("اختر طبقتين Raster ظاهرتين وغير مقفلتين على الأقل قبل الدمج.");
        return;
      }
      setImageRasterOperation({
        operation: "merge",
        layerIds: selected.map((layer) => layer.id),
      });
      return;
    }
    if (dispatch.selectPrompt) setActiveTool(dispatch.id);
    commandSequenceRef.current += 1;
    setEditorCommand({ id: dispatch.id, sequence: commandSequenceRef.current });
  }, [
    activeLayer,
    arrangeReadingOrder,
    bookLayers,
    imageLayers,
    onNotify,
    selectedIds,
  ]);

  const selectEditorTool = useCallback((toolId: ReadyWorkspaceToolId) => {
    setActiveTool(toolId);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.repeat || isEditableShortcutTarget(event.target)) return;
      const tool = workspaceTools.find(
        (candidate) =>
          candidate.available && isWorkspaceShortcut(candidate, event),
      );
      if (!tool) return;
      event.preventDefault();
      useTool(tool);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [useTool, workspaceTools]);

  const adoptGuidedDocument = async (
    document: LayerDocumentView,
    preferredLayerId?: string,
  ): Promise<void> => {
    const previewResult =
      mode === "image" && document.sourceVersionId && projectId
        ? await loadRasterLayerPreviews(
            projectId,
            document.sourceVersionId,
            document,
          )
        : { previews: new Map<string, string>(), urls: [] };
    replaceLayerAssetUrls(previewResult.urls);
    const preparedLayers = toWorkspaceLayers(
      document,
      mode,
      previewResult.previews,
    );
    applyPreparedDocument(document, preparedLayers, activePdfPage);
    adoptSavedReview(preparedLayers, document.revision ?? 1);
    setGuidanceRevision(document.guidance?.revision ?? 0);
    const nextActiveId =
      preferredLayerId &&
      preparedLayers.some((layer) => layer.id === preferredLayerId)
        ? preferredLayerId
        : preparedLayers.some((layer) => layer.id === activeLayerId)
          ? activeLayerId
          : preparedLayers[0]?.id ?? "";
    setActiveLayerId(nextActiveId);
    setSelectedIds(nextActiveId ? [nextActiveId] : []);
  };

  const executeGuidedRefinement = async (
    missingSourceMessage: string,
    buildInput: (context: GuidedRefinementContext) => GuidedRefinementInput,
    preferCreatedLayer = false,
  ): Promise<{ revision: number; warnings: string[] }> => {
    if (!projectId || !sourceVersionId) {
      throw new Error(missingSourceMessage);
    }
    if (saveInFlightRef.current) {
      throw new Error(
        "انتظر اكتمال الحفظ الجاري ثم أعد تطبيق الإرشاد.",
      );
    }
    saveInFlightRef.current = true;
    setProcessing(true);
    setSaveState("saving");
    try {
      const baseRevision = await flushLayerReview();
      const result = await applyGuidedRefinement(
        projectId,
        buildInput({
          sourceVersionId,
          baseRevision,
          appliedAt: new Date().toISOString(),
        }),
      );
      await adoptGuidedDocument(
        result.document,
        preferCreatedLayer
          ? result.createdLayerIds[0] ?? activeLayerId
          : undefined,
      );
      return {
        revision:
          result.document.guidance?.revision ?? guidanceRevision + 1,
        warnings: result.warnings,
      };
    } finally {
      saveInFlightRef.current = false;
      setProcessing(false);
    }
  };

  const navigateDocumentHistory = async (
    direction: "undo" | "redo",
  ): Promise<void> => {
    if (!projectId || !sourceVersionId) {
      onNotify("ارفع مصدرًا وجهّزه قبل التنقل في سجل التعديلات.");
      return;
    }
    setProcessing(true);
    try {
      const baseRevision = await flushLayerReview();
      const document = await navigateLayerDocumentHistory(projectId, {
        sourceVersionId,
        baseRevision,
        direction,
      });
      await adoptGuidedDocument(document);
      onNotify(
        direction === "undo"
          ? "تم التراجع عن آخر تعديل محفوظ."
          : "تمت إعادة التعديل المحفوظ التالي.",
      );
    } catch (error) {
      onNotify(
        error instanceof Error
          ? error.message
          : "تعذر التنقل في سجل التعديلات.",
      );
    } finally {
      setProcessing(false);
    }
  };

  const applyImageGuide = async (
    input: ImageGuideInput,
  ): Promise<{ revision: number; warnings: string[] }> => {
    return executeGuidedRefinement(
      "ارفع صورة قبل استخدام قلم التحديد.",
      (context: GuidedRefinementContext) =>
        createImageGuidedRefinementInput(input, activeLayerId, context),
      true,
    );
  };

  const applyPdfGuide = async (
    input: PdfGuideInput,
  ): Promise<{ revision: number; warnings: string[] }> => {
    return executeGuidedRefinement(
      "ارفع ملف PDF قبل استخدام قلم التحديد.",
      (context: GuidedRefinementContext) =>
        createPdfGuidedRefinementInput(input, activePdfPage, context),
    );
  };

  const changePdfSegmentation = async (
    nextMode: PdfSegmentation,
  ): Promise<void> => {
    if (nextMode === pdfMode) return;
    if (!projectId || !sourceVersionId) {
      setPdfMode(nextMode);
      return;
    }
    if (
      !(await requestConfirmation({
        title: "إعادة تحليل ملف PDF؟",
        description:
          "ستُعاد قراءة الملف بهذا النمط، وستُستبدل مراجعة الطبقات " +
          "والعلامات اليدوية الحالية.",
        confirmLabel: "إعادة التحليل",
        tone: "danger",
      }))
    ) {
      return;
    }
    if (saveInFlightRef.current) {
      onNotify("انتظر اكتمال الحفظ الجاري قبل تغيير نمط التقطيع.");
      return;
    }
    setProcessing(true);
    setUploadState("verifying");
    setUploadProgress(0);
    try {
      const document = await reanalyzePdfSource(
        projectId,
        sourceVersionId,
        pdfApiModes[nextMode],
        {
          onProgress: setUploadProgress,
        },
      );
      await adoptGuidedDocument(document);
      setPdfMode(nextMode);
      setUploadState("ready");
      setUploadProgress(100);
      onNotify(
        `أُعيد تحليل PDF إلى ${pdfSegmentationLabels[nextMode]} مع تحديث الطبقات وترتيب القراءة.`,
      );
    } catch (error) {
      setUploadState("ready");
      setUploadProgress(100);
      onNotify(
        error instanceof Error
          ? error.message
          : "تعذر تغيير نمط تقطيع PDF.",
      );
    } finally {
      setProcessing(false);
    }
  };

  const createExport = async (
    format: ExportFormat,
    options?: {
      scope?: "full-document" | "per-page" | "selected-page";
      selectedPage?: number;
      scale: 1;
      colorProfile: "sRGB";
      namingPresetId: string;
    },
  ) => {
    if (!projectId || !sourceVersionId) {
      throw new Error("ارفع مصدرًا حقيقيًا قبل إنشاء ملف التصدير.");
    }
    if (layerDocumentRevision === undefined) {
      throw new Error("تعذر تحديد إصدار وثيقة الطبقات. أعد تحميل المصدر.");
    }
    const saveDeadline = Date.now() + 10_000;
    while (saveInFlightRef.current && Date.now() < saveDeadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }
    if (saveInFlightRef.current) {
      throw new Error(
        "استمر الحفظ التلقائي أكثر من المتوقع. أعد المحاولة بعد التحقق من الاتصال.",
      );
    }
    const documentRevision = await flushLayerReview();
    await createExportArtifact(
      projectId,
      sourceVersionId,
      documentRevision,
      format,
      options,
    );
  };

  const openExportReview = (event: React.MouseEvent<HTMLButtonElement>) => {
    exportTriggerRef.current = event.currentTarget;
    setExportOpen(true);
  };

  const previewClassName = [
    "pro-editor-frame",
    `preview-bg--${previewBackground}`,
    grid ? "preview-grid-on" : "preview-grid-off",
    safeBounds ? "preview-safe" : "",
    previewQuality === "full" ? "preview-quality-full" : "preview-quality-fast",
  ].filter(Boolean).join(" ");

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

      <main className="pro-workspace-body">
        <WorkspaceToolRail
          mode={mode}
          tools={workspaceTools}
          activeTool={activeTool}
          collapsed={toolCollapsed}
          onCollapsedChange={setToolCollapsed}
          onToolChange={useTool}
        />

        <section className="pro-preview-column" aria-label="المعاينة الاحترافية">
          <div className="pro-source-row">
            <SourceUploadStatus
              mode={mode}
              fileName={sourceName}
              version={sourceVersion}
              state={uploadState}
              progress={uploadProgress}
              detailsOpen={uploadDetailsOpen}
              {...(uploadError ? { error: uploadError } : {})}
              {...(sourceHash ? { hash: sourceHash } : {})}
              onChoose={() => fileRef.current?.click()}
              onToggleDetails={() => setUploadDetailsOpen((value) => !value)}
              onCancel={cancelUpload}
              onRetry={() => fileRef.current?.click()}
            />
            <input
              ref={fileRef}
              className="sr-only"
              type="file"
              aria-label={
                mode === "image"
                  ? "اختيار ملف صورة للمشروع"
                  : "اختيار ملف PDF للمشروع"
              }
              accept={
                mode === "image"
                  ? ".png,.jpg,.jpeg,.webp,.avif,.tif,.tiff,.bmp"
                  : ".pdf"
              }
              onChange={(event) => {
                void chooseSource(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            {mode === "book" &&
            ocrReview?.pages.some(
              (page) => page.pageNumber === activePdfPage,
            ) ? (
              <span
                className="ocr-review-tag"
                role="status"
                title="الثقة النهائية للقراءة الضوئية أقل من حد المراجعة؛ النص محفوظ ولم يُحذف."
              >
                <Icon name="warning" size={14} />
                OCR يحتاج مراجعة بشرية
              </span>
            ) : (
              <span className="demo-tag">
                <Icon name="spark" size={14} />
                {mode === "image" && persistedSource
                  ? imagePreparation?.strategy === "alpha-components"
                    ? `${imagePreparation.outputLayers} طبقات Raster فعلية`
                    : "طبقة Raster أصلية"
                  : "معاينة إرشادية قبل رفع المصدر"}
              </span>
            )}
          </div>

          <PreviewToolbar
            zoom={zoom}
            background={previewBackground}
            quality={previewQuality}
            grid={grid}
            safeBounds={safeBounds}
            solo={solo}
            focusMode={focusMode}
            onZoomChange={setZoom}
            onBackgroundChange={setPreviewBackground}
            onQualityChange={setPreviewQuality}
            onGridChange={setGrid}
            onSafeBoundsChange={setSafeBounds}
            onSoloChange={setSolo}
            onFocusModeChange={setFocusMode}
          />

          <div className={previewClassName}>
            {!persistedSource ? (
              <EmptySourcePreview
                mode={mode}
                onChoose={() => fileRef.current?.click()}
              />
            ) : mode === "image" ? (
              <ImageGuidanceEditor
                layers={imageLayers}
                hiddenLayers={hiddenLayers}
                selectedLayerId={activeLayerId}
                onSelectedLayerChange={(id) => { setActiveLayerId(id); setSelectedIds([id]); }}
                onNotify={onNotify}
                guidanceRevision={guidanceRevision}
                onApply={applyImageGuide}
                onHistoryNavigate={navigateDocumentHistory}
                {...(imagePreparation ? { preparation: imagePreparation } : {})}
                onToolSelect={selectEditorTool}
                {...(editorCommand ? { toolCommand: editorCommand } : {})}
                {...(imageCanvasSize ? { canvasSize: imageCanvasSize } : {})}
                {...(sourcePreviewUrl ? { sourcePreviewUrl } : {})}
              />
            ) : (
              <PdfGuidanceEditor
                key={`pdf-page-${activePdfPage}`}
                segmentation={pdfMode}
                layers={bookLayers}
                pageNumber={activePdfPage}
                pageCount={pdfPageCount}
                {...(pdfPageSize ? { pageSize: pdfPageSize } : {})}
                onPageChange={(nextPage) => {
                  const page =
                    pdfPages.find(
                      (candidate) => candidate.pageNumber === nextPage,
                    ) ?? pdfPages[0];
                  setActivePdfPage(page?.pageNumber ?? nextPage);
                  if (page) {
                    setPdfPageSize({
                      width: page.width,
                      height: page.height,
                    });
                  }
                  const nextLayer = bookLayers.find(
                    (layer) =>
                      layer.pageNumber === nextPage &&
                      layer.kind !== "page",
                  );
                  if (nextLayer) {
                    setActiveLayerId(nextLayer.id);
                    setSelectedIds([nextLayer.id]);
                  }
                }}
                onSegmentationChange={changePdfSegmentation}
                segmentationBusy={processing}
                onNotify={onNotify}
                guidanceRevision={guidanceRevision}
                onApply={applyPdfGuide}
                onHistoryNavigate={navigateDocumentHistory}
                onConfirmDiscardRegions={(message) =>
                  requestConfirmation({
                    title: "تجاهل المناطق غير المحفوظة؟",
                    description: message,
                    confirmLabel: "تجاهل والانتقال",
                    tone: "danger",
                  })
                }
                onToolSelect={selectEditorTool}
                {...(editorCommand ? { toolCommand: editorCommand } : {})}
              />
            )}
          </div>
        </section>

        {persistedSource ? (
          <LayerDock
            mode={mode}
            layers={layers}
            selectedIds={selectedIds}
            activeId={activeLayerId}
            collapsed={layersCollapsed}
            width={layerWidth}
            loading={layerLoading}
            canReorder
            onCollapsedChange={setLayersCollapsed}
            onWidthChange={setLayerWidth}
            onSelectionChange={(ids, activeId) => { setSelectedIds(ids); setActiveLayerId(activeId); }}
            onLayersChange={setLayers}
            onArrangeReadingOrder={arrangeReadingOrder}
            onNotify={onNotify}
          />
        ) : <EmptyLayerDock />}
      </main>

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

      {sourceVersionsOpen && projectId && sourceVersionId && (
        <SourceVersionHistoryDialog
          projectId={projectId}
          currentSourceVersionId={sourceVersionId}
          onClose={() => setSourceVersionsOpen(false)}
          onNotify={onNotify}
          onRestored={async (result, version) => {
            const controller = new AbortController();
            setProcessing(true);
            setSourceVersionId(version.id);
            setSourceVersion(version.versionNumber);
            setSourceName(version.filename);
            setSourceHash(version.sha256 ?? undefined);
            setSourcePreviewUrl(undefined);
            setUploadState("verifying");
            setUploadProgress(0);
            try {
              let restored;
              try {
                restored = await loadWorkspaceProjectDocument(
                  {
                    id: result.project.id,
                    currentSourceVersionId:
                      result.project.currentSourceVersionId,
                  },
                  mode,
                  controller.signal,
                );
              } catch (error) {
                if (
                  !(error instanceof ApiError) ||
                  error.code !== "DOCUMENT_NOT_FOUND"
                ) {
                  throw error;
                }
                const document = await reanalyzePdfSource(
                  result.project.id,
                  version.id,
                  mode === "book" ? pdfApiModes[pdfMode] : "sentence",
                  {
                    signal: controller.signal,
                    onProgress: setUploadProgress,
                  },
                );
                await adoptGuidedDocument(document);
                setUploadState("ready");
                setUploadProgress(100);
                onNotify(
                  "تمت إعادة معالجة نسخة المصدر المستعادة لأنها لم تكن تملك وثيقة طبقات محفوظة.",
                );
                return;
              }
              replaceLayerAssetUrls(restored.previewUrls);
              applyPreparedDocument(
                restored.document,
                restored.preparedLayers,
              );
              resetLayerSelection(restored.preparedLayers);
              adoptSavedReview(
                restored.preparedLayers,
                restored.document.revision ?? 1,
              );
              setGuidanceRevision(
                restored.document.guidance?.revision ?? 0,
              );
              setUploadState("ready");
              setUploadProgress(100);
            } catch (error) {
              setUploadState("error");
              setUploadError(
                error instanceof Error
                  ? error.message
                  : "تمت استعادة المصدر، لكن تعذر تحميل طبقاته أو إعادة معالجته.",
              );
              setUploadDetailsOpen(true);
              onNotify(
                "تم تغيير المصدر بنجاح، لكن تجهيز طبقاته يحتاج إلى إعادة المحاولة.",
              );
            } finally {
              setProcessing(false);
            }
          }}
        />
      )}

      <WorkspaceMobileDock
        activePanel={mobilePanel}
        onPanelChange={setMobilePanel}
        onExport={openExportReview}
      />

      {mobilePanel !== "none" && (
        <WorkspaceMobileSheet
          activePanel={mobilePanel}
          mode={mode}
          persistedSource={persistedSource}
          tools={workspaceTools}
          activeTool={activeTool}
          layers={layers}
          selectedIds={selectedIds}
          activeLayerId={activeLayerId}
          layerCheckSummary={layerCheckSummary}
          onClose={() => setMobilePanel("none")}
          onUseTool={useTool}
          onSelectLayer={(id) => {
            setActiveLayerId(id);
            setSelectedIds([id]);
          }}
        />
      )}

      {pdfTextOperation && projectId && sourceVersionId && (
        <PdfTextOperationDialog
          operation={pdfTextOperation.operation}
          layers={pdfTextOperation.layerIds.flatMap((id) => {
            const layer = bookLayers.find((candidate) => candidate.id === id);
            return layer ? [layer] : [];
          })}
          onClose={() => setPdfTextOperation(undefined)}
          onApply={async (input) => {
            setProcessing(true);
            setUploadState("verifying");
            try {
              const baseRevision = await flushLayerReview();
              const result =
                input.operation === "split"
                  ? await splitPdfTextLayer(projectId, {
                      sourceVersionId,
                      baseRevision,
                      layerId: pdfTextOperation.layerIds[0]!,
                      offset: input.offset,
                    })
                  : await mergePdfTextLayers(projectId, {
                      sourceVersionId,
                      baseRevision,
                      layerIds: pdfTextOperation.layerIds,
                      separator: input.separator,
                    });
              const preferredLayerId =
                result.createdLayerIds[0] ??
                result.affectedLayerIds.find((id) =>
                  result.document.layers.some((layer) => layer.id === id),
                );
              await adoptGuidedDocument(
                result.document,
                preferredLayerId,
              );
              setUploadState("ready");
              setUploadProgress(100);
              onNotify(
                input.operation === "split"
                  ? "تم تقسيم الوحدة النصية وحفظ مراجعة قابلة للتراجع."
                  : "تم دمج الوحدات النصية وحفظ مراجعة قابلة للتراجع.",
              );
            } catch (error) {
              setUploadState("ready");
              setUploadProgress(100);
              throw error;
            } finally {
              setProcessing(false);
            }
          }}
        />
      )}

      {pdfRegionOcrLayer &&
        pdfRegionOcrLayer.bounds &&
        pdfRegionOcrPageSize &&
        projectId &&
        sourceVersionId && (
          <PdfRegionOcrDialog
            layer={pdfRegionOcrLayer}
            pageSize={pdfRegionOcrPageSize}
            onClose={() => setPdfRegionOcrLayerId(undefined)}
            onApply={async (paddingPercent) => {
              const bounds = pdfRegionOcrLayer.bounds!;
              const paddingRatio = paddingPercent / 100;
              const paddingX = bounds.width * paddingRatio;
              const paddingY = bounds.height * paddingRatio;
              const start = {
                x: Math.max(0, bounds.x - paddingX) / pdfRegionOcrPageSize.width,
                y: Math.max(0, bounds.y - paddingY) / pdfRegionOcrPageSize.height,
              };
              const end = {
                x:
                  Math.min(
                    pdfRegionOcrPageSize.width,
                    bounds.x + bounds.width + paddingX,
                  ) / pdfRegionOcrPageSize.width,
                y:
                  Math.min(
                    pdfRegionOcrPageSize.height,
                    bounds.y + bounds.height + paddingY,
                  ) / pdfRegionOcrPageSize.height,
              };
              setProcessing(true);
              setUploadState("verifying");
              setUploadProgress(0);
              try {
                const baseRevision = await flushLayerReview();
                const document = await runPdfRegionOcr(
                  projectId,
                  {
                    sourceVersionId,
                    baseRevision,
                    pageNumber: pdfRegionOcrLayer.pageNumber!,
                    start,
                    end,
                  },
                  { onProgress: setUploadProgress },
                );
                await adoptGuidedDocument(document);
                setUploadState("ready");
                setUploadProgress(100);
                onNotify("اكتمل OCR الإقليمي وحُفظ النص الجديد كمراجعة قابلة للتراجع.");
              } catch (error) {
                setUploadState("ready");
                setUploadProgress(100);
                throw error;
              } finally {
                setProcessing(false);
              }
            }}
          />
        )}

      {imageRasterOperation && projectId && sourceVersionId && (
        <ImageRasterOperationDialog
          operation={imageRasterOperation.operation}
          layers={imageRasterOperation.layerIds.flatMap((id) => {
            const layer = imageLayers.find((candidate) => candidate.id === id);
            return layer ? [layer] : [];
          })}
          onClose={() => setImageRasterOperation(undefined)}
          onApply={async (input) => {
            setProcessing(true);
            setUploadState("verifying");
            try {
              const baseRevision = await flushLayerReview();
              const result =
                input.operation === "edge-refine"
                  ? await refineImageLayerEdges(projectId, {
                      sourceVersionId,
                      baseRevision,
                      layerId: imageRasterOperation.layerIds[0]!,
                      radius: input.radius,
                      strength: input.strength,
                    })
                  : await mergeImageLayers(projectId, {
                      sourceVersionId,
                      baseRevision,
                      layerIds: imageRasterOperation.layerIds,
                    });
              await adoptGuidedDocument(
                result.document,
                result.createdLayerIds[0] ?? result.affectedLayerIds[0],
              );
              setUploadState("ready");
              setUploadProgress(100);
              onNotify(
                input.operation === "edge-refine"
                  ? "تم تحسين الحواف وحفظ أصل Raster جديد قابل للتراجع."
                  : "تم دمج طبقات Raster وحفظ الناتج كمراجعة قابلة للتراجع.",
              );
            } catch (error) {
              setUploadState("ready");
              setUploadProgress(100);
              throw error;
            } finally {
              setProcessing(false);
            }
          }}
        />
      )}

      {exportOpen && (
        <ExportReview
          mode={mode}
          layers={layers}
          selectedLayerId={activeLayerId}
          onSelectedLayerChange={(id) => { setActiveLayerId(id); setSelectedIds([id]); }}
          onLayersChange={setLayers}
          onClose={() => setExportOpen(false)}
          onNotify={onNotify}
          returnFocusTo={exportTriggerRef.current}
          canExport={Boolean(projectId && sourceVersionId)}
          saveState={saveState}
          onRetrySave={async () => {
            await flushLayerReview();
          }}
          {...(mode === "image" && imageCanvasSize
            ? { canvasSize: imageCanvasSize }
            : {})}
          {...(mode === "book" ? { pdfPages } : {})}
          {...(sourcePreviewUrl ? { sourcePreviewUrl } : {})}
          onCreateExport={createExport}
        />
      )}
      {confirmationDialog}
    </div>
  );
}
