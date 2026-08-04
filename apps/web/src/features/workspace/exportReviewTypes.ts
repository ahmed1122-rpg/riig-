import type { ExportFormat } from "@motionprep/contracts";
import type { Layer, ProjectMode } from "../../types";
import type { WorkspaceSaveState } from "./WorkspaceChrome";

export type PreviewBackground = "white" | "transparent" | "checker";
export type PdfScope = "document" | "pages" | "selected";
export type FormatOption = { id: ExportFormat; title: string; hint: string };

export interface ExportReviewProps {
  mode: ProjectMode;
  maxUploadBytes?: number;
  layers: Layer[];
  selectedLayerId: string;
  onSelectedLayerChange: (id: string) => void;
  onLayersChange: (layers: Layer[]) => void;
  onClose: () => void;
  onNotify: (message: string) => void;
  returnFocusTo: HTMLElement | null;
  canExport: boolean;
  saveState?: WorkspaceSaveState;
  onRetrySave?: () => Promise<void>;
  sourcePreviewUrl?: string;
  canvasSize?: { width: number; height: number };
  pdfPages?: Array<{ pageNumber: number; width: number; height: number }>;
  onCreateExport: (
    format: ExportFormat,
    options: {
      scope?: "full-document" | "per-page" | "selected-page";
      selectedPage?: number;
      scale: 1;
      colorProfile: "sRGB";
      namingPresetId: string;
    },
  ) => Promise<void>;
}
