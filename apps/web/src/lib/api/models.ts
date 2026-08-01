import type {
  AuditEvent,
  BillingPlanCatalogItem,
  CheckoutSession,
  ExportJob,
  LayerDocument,
  LayerDocumentEditResult,
  ProcessingJob,
  ProjectSummary as ContractProjectSummary,
  SourceVersionSummary as ContractSourceVersionSummary,
  SourceVersionRestoreEvent,
  SourceVersionRestoreResult,
  SubscriptionView,
  UserSummary,
} from "@motionprep/contracts";

export type SessionUser = Pick<
  UserSummary,
  "id" | "name" | "email" | "role" | "mfaEnabled"
>;

export interface UploadResult {
  projectId: string;
  sourceVersionId: string;
  sourceVersionNumber: number;
  sha256: string;
  document: LayerDocumentView;
}

export type LayerDocumentView = LayerDocument &
  Required<
    Pick<LayerDocument, "sourceVersionId" | "revision" | "generatedAt">
  >;

export type ProjectSummary = ContractProjectSummary;
export type SourceVersionSummary = ContractSourceVersionSummary;
export type { SourceVersionRestoreEvent, SourceVersionRestoreResult };
export type LayerDocumentEditView = Omit<
  LayerDocumentEditResult,
  "document"
> & { document: LayerDocumentView };
export type ExportSummary = ExportJob;

export type SubscriptionSummary = Omit<SubscriptionView, "id" | "userId">;
export type CheckoutSummary = CheckoutSession;

export interface BillingConfiguration {
  mode: "disabled" | "sandbox" | "live";
  providers: CheckoutSession["provider"][];
  plans: readonly BillingPlanCatalogItem[];
}

export type AdminUser = UserSummary;
export type AdminAuditEvent = AuditEvent;

export interface AdminOverview {
  users: { total: number; active: number; suspended: number };
  uploads: { total: number; active: number; failed: number };
  exports: { total: number; queued: number; failed: number };
  processing: { total: number; active: number; failed: number };
  billing: {
    activeSubscriptions: number;
    pendingCheckouts: number;
    paidCheckouts: number;
  };
  audit: AdminAuditEvent[];
}

export type AdminProcessingJob = ProcessingJob;

export interface AdminBillingData {
  subscriptions: Array<
    Pick<
      SubscriptionView,
      "id" | "userId" | "planId" | "status" | "renewalAt"
    >
  >;
  checkouts: Array<
    Pick<
      CheckoutSession,
      | "id"
      | "userId"
      | "provider"
      | "planId"
      | "status"
      | "currency"
      | "amountMinor"
      | "createdAt"
      | "expiresAt"
    >
  >;
}

export interface AdminSystemStatus {
  status: "ready" | "degraded";
  workers: Array<{
    instanceId: string;
    workerType: "media" | "document" | "export";
    releaseVersion: string;
    concurrency: number;
    lastSeenAt: string;
    stale: boolean;
  }>;
  queues: Array<{
    queue: "processing-media" | "processing-document" | "export";
    queued: number;
    active: number;
    failed: number;
    oldestQueuedSeconds: number;
  }>;
  maintenance: {
    task: "retention";
    lastStartedAt: string | null;
    lastSucceededAt: string | null;
    lastFailedAt: string | null;
    lastError: string | null;
    stale: boolean;
  } | null;
  checkedAt: string;
}
