import type {
  Dispatch,
  SetStateAction,
} from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConfirmationRequest } from "../../shared/useConfirmation";
import type { Layer, PdfSegmentation, ProjectMode } from "../../types";
import type { LayerDocumentView } from "../../lib/api";
import type { UploadState } from "./SourceUploadStatus";
import type { WorkspaceSaveState } from "./WorkspaceChrome";
import { useWorkspaceDocumentAdoption } from "./useWorkspaceDocumentAdoption";
import { useWorkspaceLayerMutations } from "./useWorkspaceLayerMutations";
import { useWorkspaceOperations } from "./useWorkspaceOperations";
import { useWorkspaceSourceRestoration } from "./useWorkspaceSourceRestoration";
import type {
  ImageRasterOperation,
  PdfTextOperation,
} from "./useWorkspaceToolController";
import type { DocumentCommandCoordinator } from "./useDocumentCommandCoordinator";
import {
  summarizeDocumentChange,
  type RecordDocumentChange,
} from "./documentChangeSummary";
import type { WorkspaceCommandStatus } from "./workspaceCommandStatus";

type SetState<Value> = Dispatch<SetStateAction<Value>>;

interface WorkspaceCommandOptions {
  mode: ProjectMode;
  pdfMode: PdfSegmentation;
  projectId?: string;
  sourceVersionId?: string;
  activeLayerId: string;
  activePdfPage: number;
  guidanceRevision: number;
  layerDocumentRevision?: number;
  layers: readonly Layer[];
  pdfTextOperation: PdfTextOperation | undefined;
  imageRasterOperation: ImageRasterOperation | undefined;
  pdfRegionOcrLayer: Layer | undefined;
  pdfRegionOcrPageSize: { width: number; height: number } | undefined;
  commandCoordinator: DocumentCommandCoordinator;
  replaceLayerAssetUrls: (urls: string[]) => void;
  applyPreparedDocument: (
    document: LayerDocumentView,
    layers: Layer[],
    pdfPageNumber?: number,
  ) => void;
  adoptSavedReview: (layers: Layer[], revision: number) => void;
  resetLayerSelection: (layers: readonly Layer[]) => void;
  requestConfirmation: (
    request: ConfirmationRequest,
  ) => Promise<boolean>;
  setProcessing: SetState<boolean>;
  setSaveState: SetState<WorkspaceSaveState>;
  setUploadState: SetState<UploadState>;
  setUploadProgress: SetState<number>;
  setUploadError: SetState<string | undefined>;
  setUploadDetailsOpen: SetState<boolean>;
  setPdfMode: SetState<PdfSegmentation>;
  setGuidanceRevision: SetState<number>;
  setActiveLayerId: SetState<string>;
  setSelectedIds: SetState<string[]>;
  setSourceVersionId: SetState<string | undefined>;
  setSourceVersion: SetState<number>;
  setSourceName: SetState<string>;
  setSourceHash: SetState<string | undefined>;
  setSourcePreviewUrl: SetState<string | undefined>;
  onNotify: (message: string) => void;
}

export function useWorkspaceCommands(options: WorkspaceCommandOptions) {
  const [commandStatus, setCommandStatus] = useState<WorkspaceCommandStatus>({
    phase: "idle",
  });
  const [documentChangeLog, setDocumentChangeLog] = useState<
    ReturnType<typeof summarizeDocumentChange>[]
  >([]);
  const nextDocumentChangeId = useRef(1);
  const recordDocumentChange: RecordDocumentChange = useCallback(
    (label, before, after) => {
      const summary = summarizeDocumentChange(
        nextDocumentChangeId.current++,
        label,
        before,
        after,
      );
      setDocumentChangeLog((current) => [summary, ...current].slice(0, 8));
    },
    [],
  );

  useEffect(() => {
    setDocumentChangeLog([]);
    setCommandStatus({ phase: "idle" });
  }, [options.projectId, options.sourceVersionId]);

  const adoptDocument = useWorkspaceDocumentAdoption({
    mode: options.mode,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    activePdfPage: options.activePdfPage,
    activeLayerId: options.activeLayerId,
    replaceLayerAssetUrls: options.replaceLayerAssetUrls,
    applyPreparedDocument: options.applyPreparedDocument,
    adoptSavedReview: options.adoptSavedReview,
    setGuidanceRevision: options.setGuidanceRevision,
    setActiveLayerId: options.setActiveLayerId,
    setSelectedIds: options.setSelectedIds,
  });

  const operations = useWorkspaceOperations({
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.sourceVersionId
      ? { sourceVersionId: options.sourceVersionId }
      : {}),
    activeLayerId: options.activeLayerId,
    activePdfPage: options.activePdfPage,
    guidanceRevision: options.guidanceRevision,
    ...(options.layerDocumentRevision === undefined
      ? {}
      : { layerDocumentRevision: options.layerDocumentRevision }),
    pdfMode: options.pdfMode,
    layers: options.layers,
    onDocumentChanged: recordDocumentChange,
    commandCoordinator: options.commandCoordinator,
    adoptDocument,
    requestConfirmation: options.requestConfirmation,
    setProcessing: options.setProcessing,
    setSaveState: options.setSaveState,
    setCommandStatus,
    setPdfMode: options.setPdfMode,
    onNotify: options.onNotify,
  });

  const mutations = useWorkspaceLayerMutations({
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.sourceVersionId
      ? { sourceVersionId: options.sourceVersionId }
      : {}),
    pdfTextOperation: options.pdfTextOperation,
    imageRasterOperation: options.imageRasterOperation,
    pdfRegionOcrLayer: options.pdfRegionOcrLayer,
    pdfRegionOcrPageSize: options.pdfRegionOcrPageSize,
    layers: options.layers,
    onDocumentChanged: recordDocumentChange,
    commandCoordinator: options.commandCoordinator,
    adoptDocument,
    setProcessing: options.setProcessing,
    setCommandStatus,
    onNotify: options.onNotify,
  });

  const restoreSourceVersion = useWorkspaceSourceRestoration({
    mode: options.mode,
    pdfMode: options.pdfMode,
    replaceLayerAssetUrls: options.replaceLayerAssetUrls,
    applyPreparedDocument: options.applyPreparedDocument,
    resetLayerSelection: options.resetLayerSelection,
    adoptSavedReview: options.adoptSavedReview,
    adoptDocument,
    setProcessing: options.setProcessing,
    setSourceVersionId: options.setSourceVersionId,
    setSourceVersion: options.setSourceVersion,
    setSourceName: options.setSourceName,
    setSourceHash: options.setSourceHash,
    setSourcePreviewUrl: options.setSourcePreviewUrl,
    setUploadState: options.setUploadState,
    setUploadProgress: options.setUploadProgress,
    setUploadError: options.setUploadError,
    setUploadDetailsOpen: options.setUploadDetailsOpen,
    setGuidanceRevision: options.setGuidanceRevision,
    onNotify: options.onNotify,
  });

  return {
    commandStatus,
    documentChangeLog,
    ...mutations,
    ...operations,
    restoreSourceVersion,
  };
}
