import type {
  ImageGuidanceStroke,
  PdfMarkerRegion,
  ProcessingMode,
  ProjectKind,
} from "@motionprep/contracts";

export interface GuidedRefinementInput {
  projectId: string;
  sourceVersionId: string;
  projectKind: ProjectKind;
  baseRevision: number;
  mode: ProcessingMode;
  imageStrokes: readonly ImageGuidanceStroke[];
  pdfRegions: readonly PdfMarkerRegion[];
  actorUserId?: string;
  operationId?: string;
}
