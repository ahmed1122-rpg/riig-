import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { ApplicationCapabilities } from "@motionprep/contracts";
import type { Layer, ProjectMode } from "../../types";
import { arrangeLayersForReading } from "./layerReviewState";
import {
  getReadyWorkspaceTools,
  isEditableShortcutTarget,
  isWorkspaceShortcut,
  resolveWorkspaceToolDispatch,
  type ReadyWorkspaceToolId,
  type ResolvedWorkspaceTool,
  type WorkspaceEditorCommand,
} from "./workspaceToolRegistry";

interface WorkspaceToolControllerOptions {
  mode: ProjectMode;
  persistedSource: boolean;
  features: ApplicationCapabilities["features"];
  activeLayer: Layer | undefined;
  selectedIds: readonly string[];
  imageLayers: readonly Layer[];
  bookLayers: readonly Layer[];
  setBookLayers: Dispatch<SetStateAction<Layer[]>>;
  onNotify: (message: string) => void;
}

export interface PdfTextOperation {
  operation: "split" | "merge";
  layerIds: string[];
}

export interface ImageRasterOperation {
  operation: "edge-refine" | "merge";
  layerIds: string[];
}

function initialTool(mode: ProjectMode): ReadyWorkspaceToolId {
  return mode === "image" ? "image.keep" : "pdf.line";
}

export function useWorkspaceToolController(
  options: WorkspaceToolControllerOptions,
) {
  const [activeTool, setActiveTool] = useState<ReadyWorkspaceToolId>(() =>
    initialTool(options.mode),
  );
  const [editorCommand, setEditorCommand] =
    useState<WorkspaceEditorCommand>();
  const [sourceVersionsOpen, setSourceVersionsOpen] = useState(false);
  const [pdfTextOperation, setPdfTextOperation] =
    useState<PdfTextOperation>();
  const [pdfRegionOcrLayerId, setPdfRegionOcrLayerId] =
    useState<string>();
  const [imageRasterOperation, setImageRasterOperation] =
    useState<ImageRasterOperation>();
  const commandSequenceRef = useRef(0);

  const workspaceTools = useMemo(
    () =>
      getReadyWorkspaceTools(
        options.mode,
        options.persistedSource,
        options.features,
      ),
    [options.features, options.mode, options.persistedSource],
  );

  const arrangeReadingOrder = useCallback(() => {
    if (!options.persistedSource || options.mode !== "book") {
      options.onNotify("ارفع ملف PDF وجهّزه قبل ترتيب القراءة.");
      return;
    }
    options.setBookLayers((current) => arrangeLayersForReading(current));
    options.onNotify(
      "تم ترتيب القراءة حسب الصفحة والموضع، وسيُحفظ تلقائيًا.",
    );
  }, [
    options.mode,
    options.onNotify,
    options.persistedSource,
    options.setBookLayers,
  ]);

  const useTool = useCallback(
    (tool: ResolvedWorkspaceTool) => {
      const dispatch = resolveWorkspaceToolDispatch(tool);
      if (dispatch.kind === "unavailable") {
        options.onNotify(dispatch.reason);
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
          !options.activeLayer ||
          options.activeLayer.kind !== "text" ||
          options.activeLayer.locked ||
          !options.activeLayer.bounds ||
          options.activeLayer.pageNumber === undefined
        ) {
          options.onNotify(
            "اختر طبقة نصية غير مقفلة ولها حدود على صفحة PDF قبل تشغيل OCR الإقليمي.",
          );
          return;
        }
        setPdfRegionOcrLayerId(options.activeLayer.id);
        return;
      }
      if (dispatch.kind === "pdf-split") {
        if (
          !options.activeLayer ||
          options.activeLayer.kind !== "text" ||
          options.activeLayer.locked ||
          !options.activeLayer.fullContent ||
          Array.from(options.activeLayer.fullContent).length < 2
        ) {
          options.onNotify(
            "اختر وحدة نصية غير مقفلة تحتوي حرفين على الأقل قبل التقسيم.",
          );
          return;
        }
        setPdfTextOperation({
          operation: "split",
          layerIds: [options.activeLayer.id],
        });
        return;
      }
      if (dispatch.kind === "pdf-merge") {
        const selected = options.bookLayers.filter((layer) =>
          options.selectedIds.includes(layer.id),
        );
        if (
          selected.length < 2 ||
          selected.length !== options.selectedIds.length ||
          selected.some(
            (layer) =>
              layer.kind !== "text" || layer.locked || !layer.fullContent,
          )
        ) {
          options.onNotify(
            "اختر طبقتين نصيتين غير مقفلتين على الأقل قبل الدمج.",
          );
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
          !options.activeLayer ||
          options.activeLayer.kind !== "body" ||
          options.activeLayer.locked
        ) {
          options.onNotify(
            "اختر طبقة Raster غير مقفلة قبل تحسين الحواف.",
          );
          return;
        }
        setImageRasterOperation({
          operation: "edge-refine",
          layerIds: [options.activeLayer.id],
        });
        return;
      }
      if (dispatch.kind === "image-merge") {
        const selected = options.imageLayers.filter((layer) =>
          options.selectedIds.includes(layer.id),
        );
        if (
          selected.length < 2 ||
          selected.length !== options.selectedIds.length ||
          selected.some(
            (layer) =>
              layer.kind !== "body" || layer.locked || !layer.visible,
          )
        ) {
          options.onNotify(
            "اختر طبقتين Raster ظاهرتين وغير مقفلتين على الأقل قبل الدمج.",
          );
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
      setEditorCommand({
        id: dispatch.id,
        sequence: commandSequenceRef.current,
      });
    },
    [
      arrangeReadingOrder,
      options.activeLayer,
      options.bookLayers,
      options.imageLayers,
      options.onNotify,
      options.selectedIds,
    ],
  );

  const selectEditorTool = useCallback((toolId: ReadyWorkspaceToolId) => {
    setActiveTool(toolId);
  }, []);
  const resetToolState = useCallback((mode: ProjectMode) => {
    setActiveTool(initialTool(mode));
    setEditorCommand(undefined);
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

  return {
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
  };
}
