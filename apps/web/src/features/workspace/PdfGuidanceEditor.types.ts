import type { Layer, PdfSegmentation } from "../../types";
import type {
  CorrectionMode,
  ReadyWorkspaceToolId,
  SharedEditorProps,
  WorkspaceEditorCommand,
} from "./GuidanceEditorShared";
import type { PdfRegion } from "./PdfMarkerOverlay";

export interface PdfGuidanceEditorProps extends SharedEditorProps {
  segmentation: PdfSegmentation;
  layers: Layer[];
  pageNumber?: number;
  pageCount?: number;
  pageSize?: { width: number; height: number };
  selectedLayerId?: string;
  solo?: boolean;
  onSelectedLayerChange?: (id: string) => void;
  onTextLayerChange?: (id: string, fullText: string) => void;
  onPageChange?: (pageNumber: number) => void;
  onSegmentationChange: (value: PdfSegmentation) => void | Promise<void>;
  segmentationBusy?: boolean;
  guidanceRevision?: number;
  onApply: (input: {
    mode: CorrectionMode;
    regions: PdfRegion[];
  }) => Promise<{ revision: number; warnings: string[] }>;
  toolCommand?: WorkspaceEditorCommand;
  onToolSelect?: (toolId: ReadyWorkspaceToolId) => void;
  onHistoryNavigate: (direction: "undo" | "redo") => Promise<void>;
  onConfirmDiscardRegions?: (message: string) => Promise<boolean>;
  onDraftDirtyChange?: (dirty: boolean) => void;
}
