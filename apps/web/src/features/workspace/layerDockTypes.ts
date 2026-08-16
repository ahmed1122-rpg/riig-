import type { LayerDocumentCommand } from "@motionprep/contracts";
import type { Layer, ProjectMode } from "../../types";
import type { DocumentChangeSummary } from "./documentChangeSummary";
import type { LayerCheckSummary } from "./layerChecks";

export type LayerDensity = "dense" | "comfortable";

export interface LayerDockProps {
  mode: ProjectMode;
  layers: Layer[];
  selectedIds: string[];
  activeId: string;
  collapsed: boolean;
  width: number;
  loading: boolean;
  activePdfPage?: number;
  pdfPages?: Array<{ pageNumber: number }>;
  canReorder?: boolean;
  documentChangeLog?: readonly DocumentChangeSummary[];
  checkSummary: LayerCheckSummary;
  onCollapsedChange: (value: boolean) => void;
  onWidthChange: (value: number) => void;
  onSelectionChange: (ids: string[], activeId: string) => void;
  onPdfPageChange?: (pageNumber: number) => Promise<boolean>;
  onLayersChange: (layers: Layer[]) => void;
  onLayerCommand: (command: LayerDocumentCommand) => Promise<void>;
  onNotify: (message: string) => void;
}
