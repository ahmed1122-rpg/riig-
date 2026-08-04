import type { NormalizedPoint } from "./layer-contracts.js";
import type {
  ExportFormat,
  ExportJobStatus,
  ExportScope,
  PaymentProviderId,
  PdfSeparationMode,
  ProcessingJobStatus,
  ProjectKind,
  ProjectStatus,
  SourceType,
  SourceVersionStatus,
  SubscriptionStatus,
  UploadStatus,
  UserRole,
  UserStatus,
} from "./core-contracts.js";

export interface ProjectSummary {
  id: string;
  name: string;
  kind: ProjectKind;
  status: ProjectStatus;
  currentSourceVersionId: string | null;
  currentSourceVersionNumber: number | null;
  reviewApproval: ProjectReviewApproval | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectReviewApproval {
  id: string;
  projectId: string;
  sourceVersionId: string;
  documentRevision: number;
  actorUserId: string;
  operationId: string;
  approvedAt: string;
}

export interface ProjectReviewApprovalResult {
  project: ProjectSummary;
  approval: ProjectReviewApproval;
  replayed: boolean;
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
  operationId: string;
  projectId: string;
  actorUserId: string;
  fromSourceVersionId: string;
  toSourceVersionId: string;
  reason: string;
  idempotencyKey: string;
  originatingRequestId: string;
  /** @deprecated Legacy alias of idempotencyKey during the rollout window. */
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

export interface TraceContext {
  traceparent: string;
  tracestate?: string;
}

export interface ExportJob {
  id: string;
  correlationId?: string;
  traceContext?: TraceContext;
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
    /**
     * Immutable object-storage location for this completed generation.
     * Older persisted jobs predate this field and continue to use the
     * deterministic legacy location derived from the job and filename.
     */
    objectKey?: string;
    filename: string;
    sizeBytes: number;
    sha256: string;
    expiresAt: string;
  };
}

export interface ProcessingJob {
  id: string;
  correlationId?: string;
  traceContext?: TraceContext;
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

export interface ExportArtifactDto {
  filename: string;
  sizeBytes: number;
  sha256: string;
  expiresAt: string;
}

export type ExportJobDto = Pick<
  ExportJob,
  | "id"
  | "projectId"
  | "sourceVersionId"
  | "documentRevision"
  | "projectKind"
  | "format"
  | "scope"
  | "selectedPage"
  | "scale"
  | "colorProfile"
  | "namingPresetId"
  | "status"
  | "progress"
  | "attempt"
  | "maxAttempts"
  | "errorCode"
  | "createdAt"
  | "updatedAt"
> & {
  artifact?: ExportArtifactDto;
};

export interface ProcessingJobOptionsDto {
  pdfSeparationMode?: PdfSeparationMode;
  pdfRegionOcr?: {
    pageNumber: number;
    start: NormalizedPoint;
    end: NormalizedPoint;
    baseRevision: number;
  };
}

export type ProcessingJobDto = Pick<
  ProcessingJob,
  | "id"
  | "projectId"
  | "sourceVersionId"
  | "projectKind"
  | "status"
  | "progress"
  | "attempt"
  | "maxAttempts"
  | "errorCode"
  | "createdAt"
  | "updatedAt"
> & {
  options: ProcessingJobOptionsDto;
};

export interface AdminJobOperationsDto {
  correlationId: string | null;
  traceId: string | null;
  attempt: {
    current: number;
    maximum: number;
    nextAt: string;
  };
  error: { code: string } | null;
  lease: {
    owner: string | null;
    expiresAt: string | null;
  } | null;
}

export type AdminExportJobDto = Omit<
  ExportJobDto,
  "attempt" | "maxAttempts" | "errorCode"
> &
  AdminJobOperationsDto;

export type AdminProcessingJobDto = Omit<
  ProcessingJobDto,
  "attempt" | "maxAttempts" | "errorCode"
> &
  AdminJobOperationsDto;

export type WorkflowActivityKind =
  | "upload"
  | "processing"
  | "review"
  | "export";

export type WorkflowActivityStatus =
  | "pending"
  | "running"
  | "attention"
  | "succeeded"
  | "failed"
  | "cancelled";

export type WorkflowActivityAction =
  | "open-project"
  | "review-project"
  | "view-exports";

export interface WorkflowActivityItem {
  id: string;
  kind: WorkflowActivityKind;
  status: WorkflowActivityStatus;
  project: Pick<ProjectSummary, "id" | "name" | "kind">;
  sourceVersionId: string | null;
  jobId: string | null;
  progress: number | null;
  errorCode: string | null;
  recommendedAction: WorkflowActivityAction;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowActivityFeed {
  items: WorkflowActivityItem[];
  summary: {
    active: number;
    needsAttention: number;
    failed: number;
  };
  nextCursor: string | null;
  generatedAt: string;
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
