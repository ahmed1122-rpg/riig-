import type { MutableRefObject } from "react";
import type { ApplicationCapabilities, LayerDocumentCommand } from "@motionprep/contracts";
import type { ConfirmationRequest } from "../../shared/useConfirmation";
import type { PdfSegmentation, ProjectMode } from "../../types";
import type { DocumentChangeSummary } from "./documentChangeSummary";
import type { LayerCheckSummary } from "./layerChecks";
import type { ImageGuideInput, PdfGuideInput } from "./workspaceGuidance";
import type { WorkspaceToolController } from "./useWorkspaceToolController";
import type {
  WorkspaceEditorState,
  WorkspaceReviewState,
  WorkspaceSourceState,
} from "./useWorkspaceStateControllers";

export interface WorkspaceEditorLayoutProps {
  context: {
    mode: ProjectMode;
    authenticated: boolean;
    maxUploadBytes: ApplicationCapabilities["limits"]["maxUploadBytes"];
    onRequireAuth: () => void;
    onNotify: (message: string) => void;
  };
  source: WorkspaceSourceState;
  review: WorkspaceReviewState;
  editor: WorkspaceEditorState;
  tools: WorkspaceToolController;
  actions: {
    fileRef: MutableRefObject<HTMLInputElement | null>;
    chooseSource: (file?: File) => Promise<void>;
    cancelUpload: () => void;
    hiddenLayers: string[];
    onApplyImageGuide: (
      input: ImageGuideInput,
    ) => Promise<{ revision: number; warnings: string[] }>;
    onApplyPdfGuide: (
      input: PdfGuideInput,
    ) => Promise<{ revision: number; warnings: string[] }>;
    onHistoryNavigate: (direction: "undo" | "redo") => Promise<void>;
    onPdfSegmentationChange: (mode: PdfSegmentation) => Promise<void>;
    onConfirm: (request: ConfirmationRequest) => Promise<boolean>;
    onSelectLayer: (id: string, selectedIds?: string[]) => Promise<void>;
    onPdfPageChange: (pageNumber: number) => Promise<boolean>;
    onDraftDirtyChange: (dirty: boolean) => void;
    onLayerCommand: (command: LayerDocumentCommand) => Promise<void>;
    documentChangeLog: readonly DocumentChangeSummary[];
    layerCheckSummary: LayerCheckSummary;
  };
}
