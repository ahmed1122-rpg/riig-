export const MAX_UPLOAD_MEBIBYTES = 30;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MEBIBYTES * 1024 * 1024;
export const MAX_PDF_PAGES = 250;
export const MAX_PDF_TEXT_ITEMS = 100_000;
export const APPLICATION_CAPABILITIES_SCHEMA_VERSION = "1.0";
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordRequirementStatus {
  length: boolean;
  lowercaseLatin: boolean;
  uppercaseLatin: boolean;
  number: boolean;
}

export function evaluatePasswordRequirements(
  password: string,
): PasswordRequirementStatus {
  return {
    length:
      password.length >= PASSWORD_MIN_LENGTH &&
      password.length <= PASSWORD_MAX_LENGTH,
    lowercaseLatin: /[a-z]/u.test(password),
    uppercaseLatin: /[A-Z]/u.test(password),
    number: /[0-9]/u.test(password),
  };
}

export function isStrongPassword(password: string): boolean {
  return Object.values(evaluatePasswordRequirements(password)).every(Boolean);
}
export const BILLING_PLAN_CATALOG = [
  {
    id: "starter",
    prices: { USD: 0, EGP: 0 },
    jobLimit: 5,
    processingMinuteLimit: 30,
    recommended: false,
  },
  {
    id: "creator",
    prices: { USD: 1_900, EGP: 95_000 },
    jobLimit: 100,
    processingMinuteLimit: 500,
    recommended: true,
  },
  {
    id: "studio",
    prices: { USD: 4_900, EGP: 245_000 },
    jobLimit: 500,
    processingMinuteLimit: 3_000,
    recommended: false,
  },
] as const;

export type BillingPlanCatalogItem =
  (typeof BILLING_PLAN_CATALOG)[number];
export const MAX_IMAGE_LAYERS = 15;

export interface ApplicationCapabilities {
  schemaVersion: typeof APPLICATION_CAPABILITIES_SCHEMA_VERSION;
  limits: {
    maxUploadBytes: number;
    maxPdfPages: number;
    maxPdfTextItems: number;
    maxImageLayers: number;
  };
  features: {
    pdfRegionOcr: {
      enabled: boolean;
      unavailableReason: string | null;
    };
  };
}

export const acceptedSourceTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/tiff",
  "image/bmp",
  "application/pdf",
] as const;

export type SourceType = (typeof acceptedSourceTypes)[number];
export type ProjectKind = "image" | "book";
export type UserRole = "creator" | "support" | "finance" | "admin";
export type UserStatus = "active" | "suspended" | "pending_verification";
export type PdfSeparationMode =
  | "heading"
  | "topic"
  | "sentence"
  | "line"
  | "word"
  | "character";
export type AutoFillPolicy = "automatic" | "review" | "off";
export type ProcessingMode = "automatic" | "manual" | "guided";
export type ImageGuidanceKind = "include" | "exclude" | "separate";
export type PdfMarkerKind = "heading" | "line" | "topic" | "ignore";
export const exportFormats = [
  "psd",
  "png-layers-json",
  "layered-tiff",
  "transparent-pngs",
  "txt",
  "csv",
  "json",
] as const;
export type ExportFormat = (typeof exportFormats)[number];
export const exportFormatsByProjectKind = {
  image: [
    "psd",
    "png-layers-json",
    "layered-tiff",
    "transparent-pngs",
  ],
  book: ["psd", "png-layers-json", "txt", "csv", "json"],
} as const satisfies Record<ProjectKind, readonly ExportFormat[]>;
export function supportsExportFormat(
  projectKind: ProjectKind,
  format: ExportFormat,
): boolean {
  return (exportFormatsByProjectKind[projectKind] as readonly ExportFormat[])
    .includes(format);
}
export type ExportScope = "full-document" | "per-page" | "selected-page";
export type UploadStatus =
  | "validating"
  | "uploading"
  | "verifying"
  | "ready"
  | "failed"
  | "cancelled";
export type SourceVersionStatus = UploadStatus;
export type ExportJobStatus =
  | "preflight"
  | "queued"
  | "generating"
  | "verifying"
  | "ready"
  | "failed"
  | "cancelled";
export type ProcessingJobStatus =
  | "queued"
  | "processing"
  | "verifying"
  | "ready"
  | "failed"
  | "cancelled";
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "cancelled";
export type PaymentProviderId = "sandbox-card" | "sandbox-local" | "stripe";
export type ProjectStatus =
  | "draft"
  | "validating"
  | "uploading"
  | "queued"
  | "processing"
  | "needs_review"
  | "approved"
  | "exporting"
  | "completed"
  | "failed"
  | "cancelled";

export interface ProjectSummary {
  id: string;
  name: string;
  kind: ProjectKind;
  status: ProjectStatus;
  currentSourceVersionId: string | null;
  currentSourceVersionNumber: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceVersionSummary {
  id: string;
  projectId: string;
  uploadId: string;
  versionNumber: number;
  filename: string;
  contentType: SourceType;
  sizeBytes: number;
  status: SourceVersionStatus;
  sha256: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceVersionRestoreEvent {
  id: string;
  projectId: string;
  actorUserId: string;
  fromSourceVersionId: string;
  toSourceVersionId: string;
  reason: string;
  requestId: string;
  createdAt: string;
}

export interface SourceVersionRestoreResult {
  project: ProjectSummary;
  event: SourceVersionRestoreEvent;
  replayed: boolean;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  mfaEnabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface SessionView {
  user: UserSummary;
  expiresAt: string;
}

export interface SubscriptionView {
  id: string;
  userId: string;
  planId: "starter" | "creator" | "studio";
  status: SubscriptionStatus;
  renewalAt: string;
  provider?: PaymentProviderId;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  cancelAtPeriodEnd?: boolean;
  usage: {
    jobs: number;
    jobLimit: number;
    processingMinutes: number;
    processingMinuteLimit: number;
  };
}

export interface CheckoutSession {
  id: string;
  userId: string;
  provider: PaymentProviderId;
  planId: SubscriptionView["planId"];
  status: "pending" | "redirect_required" | "paid" | "failed" | "cancelled";
  currency: "USD" | "EGP";
  amountMinor: number;
  checkoutUrl: string | null;
  providerReference?: string;
  createdAt: string;
  expiresAt: string;
}

export interface AuditEvent {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  outcome: "success" | "denied" | "failed";
  reason: string | null;
  requestId: string;
  createdAt: string;
}

export interface CreateProjectInput {
  name: string;
  kind: ProjectKind;
}

export interface UploadIntentInput {
  projectId: string;
  filename: string;
  contentType: SourceType;
  sizeBytes: number;
  replaceSourceVersion?: boolean;
}

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

export interface ExportRequest {
  projectId: string;
  sourceVersionId: string;
  documentRevision?: number;
  format: ExportFormat;
  scope: ExportScope;
  selectedPage?: number;
  scale: 1 | 2;
  colorProfile: "sRGB" | "display-p3";
  namingPresetId: string;
}

export interface ExportJob {
  id: string;
  correlationId?: string;
  projectId: string;
  sourceVersionId: string;
  documentRevision?: number;
  projectKind: ProjectKind;
  format: ExportFormat;
  scope: ExportScope;
  selectedPage?: number;
  scale: 1 | 2;
  colorProfile: "sRGB" | "display-p3";
  namingPresetId: string;
  status: ExportJobStatus;
  progress: number;
  attempt: number;
  maxAttempts: number;
  nextAttemptAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  artifact?: {
    filename: string;
    sizeBytes: number;
    sha256: string;
    expiresAt: string;
  };
}

export interface ProcessingJob {
  id: string;
  correlationId?: string;
  projectId: string;
  sourceVersionId: string;
  projectKind: ProjectKind;
  options: {
    pdfSeparationMode?: PdfSeparationMode;
    pdfRegionOcr?: {
      pageNumber: number;
      start: NormalizedPoint;
      end: NormalizedPoint;
      baseRevision: number;
      actorUserId: string;
      operationId: string;
    };
  };
  status: ProcessingJobStatus;
  progress: number;
  attempt: number;
  maxAttempts: number;
  nextAttemptAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UploadIntent {
  uploadId: string;
  objectKey: string;
  expiresAt: string;
  maxBytes: number;
  uploadUrl: string;
}

export interface UploadSession extends UploadIntent {
  projectId: string;
  filename: string;
  contentType: SourceType;
  expectedSizeBytes: number;
  status: UploadStatus;
  sourceVersionId: string | null;
  sha256: string | null;
  createdAt: string;
  updatedAt: string;
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
  | "guided-refinement"
  | "pdf-region-ocr"
  | "pdf-split"
  | "pdf-merge"
  | "image-edge-refine"
  | "image-merge";

export interface LayerEditEntry {
  operationId: string;
  kind: LayerEditKind;
  revision: number;
  actorUserId: string;
  createdAt: string;
  affectedLayerIds?: string[];
  createdLayerIds?: string[];
  removedLayerIds?: string[];
}

export interface LayerEditTimeline {
  cursor: number;
  entries: LayerEditEntry[];
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

export interface LayerStateUpdate {
  id: string;
  name: `+${string}`;
  visible: boolean;
  locked: boolean;
  opacity: number;
  zIndex: number;
  readingOrder?: number;
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
