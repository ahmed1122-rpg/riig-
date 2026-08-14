import type { ImageGuidanceKind, PdfMarkerKind, ProcessingMode } from "./core-contracts.js";

export const MAX_LAYER_TEXT_CHARACTERS = 20_000;

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface ImageGuidanceStroke {
  id: string;
  targetLayerId: string | null;
  kind: ImageGuidanceKind;
  brushSize: number;
  points: NormalizedPoint[];
  createdAt: string;
}

export interface PdfMarkerRegion {
  id: string;
  pageNumber: number;
  kind: PdfMarkerKind;
  start: NormalizedPoint;
  end: NormalizedPoint;
  readingOrder: number | null;
  createdAt: string;
}

export interface GuidanceSnapshot {
  revision: number;
  mode: ProcessingMode;
  imageStrokes: ImageGuidanceStroke[];
  pdfRegions: PdfMarkerRegion[];
  affectedBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  appliedAt: string;
  warnings: string[];
}

export interface GuidedRefinementResult {
  document: LayerDocument;
  affectedLayerIds: string[];
  createdLayerIds: string[];
  warnings: string[];
}

export type LayerKind = "raster" | "text" | "group";

export interface LayerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RasterAssetReference {
  objectKey: string;
  contentType: "image/png";
  sizeBytes: number;
  sha256: string;
}

export interface LayerNode {
  id: string;
  parentId: string | null;
  kind: LayerKind;
  name: `+${string}`;
  visible: boolean;
  locked: boolean;
  opacity: number;
  fixed: boolean;
  zIndex: number;
  confidence?: number;
  fullText?: string;
  pageNumber?: number;
  bounds?: LayerBounds;
  readingOrder?: number;
  fontFamily?: string;
  fontSize?: number;
  direction?: "ltr" | "rtl";
  textAlign?: "start" | "center" | "end" | "justify";
  fillColor?: "#ffffff";
  rasterAsset?: RasterAssetReference;
}

export function layerLayoutMetadata(layer: LayerNode) {
  return {
    ...(layer.pageNumber === undefined
      ? {}
      : { pageNumber: layer.pageNumber }),
    ...(layer.bounds ? { bounds: layer.bounds } : {}),
    ...(layer.readingOrder === undefined
      ? {}
      : { readingOrder: layer.readingOrder }),
    ...(layer.direction ? { direction: layer.direction } : {}),
    ...(layer.textAlign ? { textAlign: layer.textAlign } : {}),
    ...(layer.fontFamily
      ? { fontFamily: layer.fontFamily }
      : {}),
    ...(layer.fontSize === undefined
      ? {}
      : { fontSize: layer.fontSize }),
  };
}

export interface DocumentPage {
  pageNumber: number;
  width: number;
  height: number;
}

export type OcrReviewReason = "low_confidence";

export interface OcrPageReview {
  pageNumber: number;
  status: "needs_review";
  reasons: OcrReviewReason[];
  wordCount: number;
  averageConfidence: number;
  arabicCharacterRatio: number;
  contentCoverage: number;
  fallbackUsed: boolean;
}

export type LayerEditKind =
  | "baseline"
  | "layer-state"
  | "layer-command"
  | "guided-refinement"
  | "pdf-region-ocr"
  | "pdf-split"
  | "pdf-merge"
  | "history-navigation"
  | "image-edge-refine"
  | "image-merge";

export interface LayerEditEntry {
  operationId: string;
  requestHash?: string;
  kind: LayerEditKind;
  revision: number;
  actorUserId: string;
  createdAt: string;
  affectedLayerIds?: string[];
  createdLayerIds?: string[];
  removedLayerIds?: string[];
}

export interface LayerHistoryNavigationEntry {
  operationId: string;
  requestHash: string;
  direction: "undo" | "redo";
  fromRevision: number;
  resultRevision: number;
  actorUserId: string;
  createdAt: string;
}

export interface LayerEditTimeline {
  cursor: number;
  entries: LayerEditEntry[];
  navigationEntries?: LayerHistoryNavigationEntry[];
}

export interface LayerDocumentEditResult {
  document: LayerDocument;
  affectedLayerIds: string[];
  createdLayerIds: string[];
  removedLayerIds: string[];
}

export interface LayerDocument {
  schemaVersion: "1.0";
  projectId: string;
  sourceVersionId?: string;
  revision?: number;
  generatedAt?: string;
  width: number;
  height: number;
  colorSpace: "sRGB";
  pages?: DocumentPage[];
  layers: LayerNode[];
  imagePreparation?: {
    strategy: "alpha-components" | "single-source";
    detectedComponents: number;
    outputLayers: number;
    overflowMerged: boolean;
    fallbackReason?:
      | "opaque-source"
      | "single-component"
      | "pixel-budget"
      | "bounds-budget";
  };
  ocrReview?: {
    policyVersion: "1.0";
    status: "needs_review";
    pages: OcrPageReview[];
  };
  guidance?: GuidanceSnapshot;
  editTimeline?: LayerEditTimeline;
}

export interface ProductionIssue {
  code:
    | "IMAGE_LAYER_LIMIT_EXCEEDED"
    | "IMAGE_RASTER_ASSET_MISSING"
    | "IMAGE_RASTER_ASSET_DUPLICATE"
    | "IMAGE_RASTER_BOUNDS_INVALID"
    | "INVALID_LAYER_PREFIX"
    | "INVALID_LAYER_NAME"
    | "LAYER_OPACITY_INVALID"
    | "LAYER_Z_INDEX_INVALID"
    | "LAYER_READING_ORDER_INVALID"
    | "DUPLICATE_LAYER_ID"
    | "DUPLICATE_LAYER_NAME"
    | "MISSING_LAYER_PARENT"
    | "LAYER_PARENT_NOT_GROUP"
    | "LAYER_PARENT_CYCLE"
    | "CROSS_PAGE_PARENT"
    | "EMPTY_LAYER_GROUP"
    | "PDF_PAGE_GROUP_MISSING"
    | "PDF_PAGE_GROUP_INVALID"
    | "PDF_BACKGROUND_MISSING"
    | "PDF_BACKGROUND_NOT_FIXED";
  message: string;
  layerId?: string;
  pageNumber?: number;
}

export type LayerCommandScope =
  | { kind: "document" }
  | { kind: "page"; pageNumber: number }
  | { kind: "parent"; parentId: string | null }
  | { kind: "layers"; layerIds: string[] };

export type LayerDocumentCommand =
  | { kind: "normalize-names"; scope: LayerCommandScope }
  | {
      kind: "arrange-reading-order";
      scope: LayerCommandScope;
      order: "reading" | "reverse";
    }
  | {
      kind: "update-state";
      scope: LayerCommandScope;
      visible?: boolean;
      locked?: boolean;
    }
  | {
      kind: "move-layer";
      layerId: string;
      targetLayerId: string;
      position: "before" | "after";
    };

export interface LayerStateUpdate {
  id: string;
  name: `+${string}`;
  visible: boolean;
  locked: boolean;
  opacity: number;
  zIndex: number;
  readingOrder?: number;
  bounds?: LayerBounds;
  direction?: "ltr" | "rtl";
  textAlign?: "start" | "center" | "end" | "justify";
  fontFamily?: string;
  fontSize?: number;
  fullText?: string;
}

export interface ApiError {
  code: string;
  message: string;
  fields?: Record<string, string>;
  requestId: string;
}

export interface ApiEnvelope<T> {
  data: T | null;
  error: ApiError | null;
}
