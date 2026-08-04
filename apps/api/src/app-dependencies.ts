import type { PdfOcrEngine } from "@motionprep/document-processing";
import type { AdminAccessCommand } from "./admin/admin-access-command.js";
import type { AuditRepository } from "./audit/audit-repository.js";
import type { EmailSender } from "./auth/email-sender.js";
import type { LoginAttemptStore } from "./auth/login-attempt-store.js";
import type { AuthRepository } from "./auth/auth-repository.js";
import type { SecretProtector } from "./auth/secret-protector.js";
import type { BillingRepository } from "./billing/billing-repository.js";
import type { PaymentProvider } from "./billing/payment-provider.js";
import type { UsageMeter } from "./billing/usage-meter.js";
import type { ExportRepository } from "./exports/export-repository.js";
import type { IdempotencyStore } from "./idempotency/idempotency-store.js";
import type { RateLimitStoreConstructor } from "./infrastructure/redis/redis-rate-limit-store.js";
import type { OperationalStatusProvider } from "./observability/operational-status.js";
import type {
  LayerDocumentRepository,
  ProcessingJobRepository,
} from "./processing/processing-repository.js";
import type { ProjectRepository } from "./projects/project-repository.js";
import type { ProjectReviewCommand } from "./projects/project-review.js";
import type { SourceVersionRepository } from "./sources/source-version-repository.js";
import type { SourceVersionRestoreCommand } from "./sources/source-version-restore.js";
import type { ObjectStorage } from "./storage/object-storage.js";
import type { AccountPrivacyRepository } from "./privacy/account-privacy.js";
import type { UploadCancellationCommand } from "./uploads/upload-cancellation.js";
import type { UploadFinalizationCommand } from "./uploads/upload-finalization.js";
import type { UploadIntegrityFailureCommand } from "./uploads/upload-integrity-failure.js";
import type { UploadRepository } from "./uploads/upload-repository.js";

export interface AppDependencies {
  projects?: ProjectRepository;
  uploads?: UploadRepository;
  uploadFinalization?: UploadFinalizationCommand;
  uploadIntegrityFailures?: UploadIntegrityFailureCommand;
  uploadCancellations?: UploadCancellationCommand;
  sourceVersions?: SourceVersionRepository;
  sourceVersionRestores?: SourceVersionRestoreCommand;
  exports?: ExportRepository;
  auth?: AuthRepository;
  audit?: AuditRepository;
  billing?: BillingRepository;
  idempotency?: IdempotencyStore;
  loginAttempts?: LoginAttemptStore;
  objectStorage?: ObjectStorage;
  processingJobs?: ProcessingJobRepository;
  layerDocuments?: LayerDocumentRepository;
  projectReviews?: ProjectReviewCommand;
  emailSender?: EmailSender;
  secretProtector?: SecretProtector;
  paymentProviders?: PaymentProvider[];
  pdfOcrEngine?: PdfOcrEngine;
  readiness?: () => Promise<void>;
  dependencyReadiness?: Readonly<Record<string, () => Promise<void>>>;
  metricsProbeTimeoutMs?: number;
  adminAccess?: AdminAccessCommand;
  usageMeter?: UsageMeter;
  operationalStatus?: OperationalStatusProvider;
  rateLimitStore?: RateLimitStoreConstructor;
  accountPrivacy?: AccountPrivacyRepository;
}
