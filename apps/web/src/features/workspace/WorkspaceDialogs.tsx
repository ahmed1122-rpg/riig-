import type { MouseEvent } from "react";
import type { ExportFormat } from "@motionprep/contracts";
import type { Layer, ProjectMode } from "../../types";
import { ExportReview } from "./ExportReview";
import { ImageRasterOperationDialog } from "./ImageRasterOperationDialog";
import { PdfRegionOcrDialog } from "./PdfRegionOcrDialog";
import { PdfTextOperationDialog } from "./PdfTextOperationDialog";
import { SourceVersionHistoryDialog } from "./SourceVersionHistoryDialog";
import {
  WorkspaceMobileDock,
  WorkspaceMobileSheet,
  type WorkspaceMobilePanel,
  type WorkspaceSaveState,
} from "./WorkspaceChrome";
import type { LayerCheckSummary } from "./layerChecks";
import type {
  ReadyWorkspaceToolId,
  ResolvedWorkspaceTool,
} from "./workspaceToolRegistry";
import type {
  ImageRasterOperation,
  PdfTextOperation,
} from "./useWorkspaceToolController";
import type { WorkspaceExportOptions } from "./useWorkspaceOperations";
import type {
  SourceVersionRestoreResult,
  SourceVersionSummary,
} from "../../lib/api";
import type { WorkspaceToolController } from "./useWorkspaceToolController";
import type {
  WorkspaceEditorState,
  WorkspaceReviewState,
  WorkspaceSourceState,
} from "./useWorkspaceStateControllers";

interface WorkspaceDialogsModel {
  mode: ProjectMode;
  maxUploadBytes: number;
  persistedSource: boolean;
  projectId: string | undefined;
  sourceVersionId: string | undefined;
  sourceVersionsOpen: boolean;
  onCloseSourceVersions: () => void;
  onRestoreSourceVersion: (
    result: SourceVersionRestoreResult,
    version: SourceVersionSummary,
  ) => Promise<void>;
  mobilePanel: WorkspaceMobilePanel;
  onMobilePanelChange: (panel: WorkspaceMobilePanel) => void;
  onExport: (event: MouseEvent<HTMLButtonElement>) => void;
  tools: readonly ResolvedWorkspaceTool[];
  activeTool: ReadyWorkspaceToolId;
  layers: Layer[];
  selectedIds: string[];
  activeLayerId: string;
  layerCheckSummary: LayerCheckSummary;
  onUseTool: (tool: ResolvedWorkspaceTool) => void;
  onSelectLayer: (id: string) => void;
  pdfTextOperation: PdfTextOperation | undefined;
  onClosePdfTextOperation: () => void;
  onApplyPdfTextOperation: (
    input:
      | { operation: "split"; offset: number }
      | { operation: "merge"; separator: "space" | "newline" },
  ) => Promise<void>;
  bookLayers: Layer[];
  pdfRegionOcrLayer: Layer | undefined;
  pdfRegionOcrPageSize: { width: number; height: number } | undefined;
  onClosePdfRegionOcr: () => void;
  onApplyPdfRegionOcr: (paddingPercent: number) => Promise<void>;
  imageRasterOperation: ImageRasterOperation | undefined;
  imageLayers: Layer[];
  onCloseImageRasterOperation: () => void;
  onApplyImageRasterOperation: (
    input:
      | {
          operation: "edge-refine";
          radius: 1 | 2 | 3;
          strength: number;
        }
      | { operation: "merge" },
  ) => Promise<void>;
  exportOpen: boolean;
  onCloseExport: () => void;
  exportReturnFocusTo: HTMLElement | null;
  saveState: WorkspaceSaveState;
  onRetrySave: () => Promise<void>;
  imageCanvasSize: { width: number; height: number } | undefined;
  pdfPages: Array<{ pageNumber: number; width: number; height: number }>;
  sourcePreviewUrl: string | undefined;
  onLayersChange: (layers: Layer[]) => void;
  onCreateExport: (
    format: ExportFormat,
    options: WorkspaceExportOptions,
  ) => Promise<void>;
  onNotify: (message: string) => void;
}

interface WorkspaceDialogsProps {
  context: {
    mode: ProjectMode;
    maxUploadBytes: number;
    onNotify: (message: string) => void;
  };
  source: WorkspaceSourceState;
  review: WorkspaceReviewState;
  editor: WorkspaceEditorState;
  tools: WorkspaceToolController;
  actions: {
    onRestoreSourceVersion: WorkspaceDialogsModel["onRestoreSourceVersion"];
    onExport: WorkspaceDialogsModel["onExport"];
    layerCheckSummary: LayerCheckSummary;
    onApplyPdfTextOperation: WorkspaceDialogsModel["onApplyPdfTextOperation"];
    pdfRegionOcrLayer: Layer | undefined;
    pdfRegionOcrPageSize: WorkspaceDialogsModel["pdfRegionOcrPageSize"];
    onApplyPdfRegionOcr: WorkspaceDialogsModel["onApplyPdfRegionOcr"];
    onApplyImageRasterOperation: WorkspaceDialogsModel["onApplyImageRasterOperation"];
    exportReturnFocusTo: HTMLElement | null;
    onRetrySave: WorkspaceDialogsModel["onRetrySave"];
    onCreateExport: WorkspaceDialogsModel["onCreateExport"];
  };
}

export function WorkspaceDialogs({
  context,
  source,
  review,
  editor,
  tools,
  actions,
}: WorkspaceDialogsProps) {
  const props: WorkspaceDialogsModel = {
    mode: context.mode,
    maxUploadBytes: context.maxUploadBytes,
    persistedSource: source.persistedSource,
    projectId: source.projectId,
    sourceVersionId: source.sourceVersionId,
    sourceVersionsOpen: tools.sourceVersionsOpen,
    onCloseSourceVersions: () => tools.setSourceVersionsOpen(false),
    onRestoreSourceVersion: actions.onRestoreSourceVersion,
    mobilePanel: editor.mobilePanel,
    onMobilePanelChange: editor.setMobilePanel,
    onExport: actions.onExport,
    tools: tools.workspaceTools,
    activeTool: tools.activeTool,
    layers: review.layers,
    selectedIds: review.selectedIds,
    activeLayerId: review.activeLayerId,
    layerCheckSummary: actions.layerCheckSummary,
    onUseTool: tools.useTool,
    onSelectLayer: review.selectLayer,
    pdfTextOperation: tools.pdfTextOperation,
    onClosePdfTextOperation: () => tools.setPdfTextOperation(undefined),
    onApplyPdfTextOperation: actions.onApplyPdfTextOperation,
    bookLayers: review.bookLayers,
    pdfRegionOcrLayer: actions.pdfRegionOcrLayer,
    pdfRegionOcrPageSize: actions.pdfRegionOcrPageSize,
    onClosePdfRegionOcr: () => tools.setPdfRegionOcrLayerId(undefined),
    onApplyPdfRegionOcr: actions.onApplyPdfRegionOcr,
    imageRasterOperation: tools.imageRasterOperation,
    imageLayers: review.imageLayers,
    onCloseImageRasterOperation: () =>
      tools.setImageRasterOperation(undefined),
    onApplyImageRasterOperation: actions.onApplyImageRasterOperation,
    exportOpen: editor.exportOpen,
    onCloseExport: () => editor.setExportOpen(false),
    exportReturnFocusTo: actions.exportReturnFocusTo,
    saveState: review.saveState,
    onRetrySave: actions.onRetrySave,
    imageCanvasSize: source.imageCanvasSize,
    pdfPages: source.pdfPages,
    sourcePreviewUrl: source.sourcePreviewUrl,
    onLayersChange: review.setLayers,
    onCreateExport: actions.onCreateExport,
    onNotify: context.onNotify,
  };
  return (
    <>
      {props.sourceVersionsOpen &&
        props.projectId &&
        props.sourceVersionId && (
          <SourceVersionHistoryDialog
            projectId={props.projectId}
            currentSourceVersionId={props.sourceVersionId}
            onClose={props.onCloseSourceVersions}
            onNotify={props.onNotify}
            onRestored={props.onRestoreSourceVersion}
          />
        )}

      <WorkspaceMobileDock
        activePanel={props.mobilePanel}
        onPanelChange={props.onMobilePanelChange}
        onExport={props.onExport}
      />

      {props.mobilePanel !== "none" && (
        <WorkspaceMobileSheet
          activePanel={props.mobilePanel}
          mode={props.mode}
          persistedSource={props.persistedSource}
          tools={props.tools}
          activeTool={props.activeTool}
          layers={props.layers}
          selectedIds={props.selectedIds}
          activeLayerId={props.activeLayerId}
          layerCheckSummary={props.layerCheckSummary}
          onClose={() => props.onMobilePanelChange("none")}
          onUseTool={props.onUseTool}
          onSelectLayer={props.onSelectLayer}
        />
      )}

      {props.pdfTextOperation &&
        props.projectId &&
        props.sourceVersionId && (
          <PdfTextOperationDialog
            operation={props.pdfTextOperation.operation}
            layers={props.pdfTextOperation.layerIds.flatMap((id) => {
              const layer = props.bookLayers.find(
                (candidate) => candidate.id === id,
              );
              return layer ? [layer] : [];
            })}
            onClose={props.onClosePdfTextOperation}
            onApply={props.onApplyPdfTextOperation}
          />
        )}

      {props.pdfRegionOcrLayer?.bounds &&
        props.pdfRegionOcrPageSize &&
        props.projectId &&
        props.sourceVersionId && (
          <PdfRegionOcrDialog
            layer={props.pdfRegionOcrLayer}
            pageSize={props.pdfRegionOcrPageSize}
            onClose={props.onClosePdfRegionOcr}
            onApply={props.onApplyPdfRegionOcr}
          />
        )}

      {props.imageRasterOperation &&
        props.projectId &&
        props.sourceVersionId && (
          <ImageRasterOperationDialog
            operation={props.imageRasterOperation.operation}
            layers={props.imageRasterOperation.layerIds.flatMap((id) => {
              const layer = props.imageLayers.find(
                (candidate) => candidate.id === id,
              );
              return layer ? [layer] : [];
            })}
            onClose={props.onCloseImageRasterOperation}
            onApply={props.onApplyImageRasterOperation}
          />
        )}

      {props.exportOpen && (
        <ExportReview
          mode={props.mode}
          maxUploadBytes={props.maxUploadBytes}
          layers={props.layers}
          selectedLayerId={props.activeLayerId}
          onSelectedLayerChange={props.onSelectLayer}
          onLayersChange={props.onLayersChange}
          onClose={props.onCloseExport}
          onNotify={props.onNotify}
          returnFocusTo={props.exportReturnFocusTo}
          canExport={Boolean(props.projectId && props.sourceVersionId)}
          saveState={props.saveState}
          onRetrySave={props.onRetrySave}
          {...(props.mode === "image" && props.imageCanvasSize
            ? { canvasSize: props.imageCanvasSize }
            : {})}
          {...(props.mode === "book" ? { pdfPages: props.pdfPages } : {})}
          {...(props.sourcePreviewUrl
            ? { sourcePreviewUrl: props.sourcePreviewUrl }
            : {})}
          onCreateExport={props.onCreateExport}
        />
      )}
    </>
  );
}
