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
