import type { FastifyBaseLogger } from "fastify";
import { MAX_IMAGE_UPLOAD_BYTES } from "@motionprep/contracts";
import type { IdempotencyStore } from "../idempotency/idempotency-store.js";
import type { ProjectRepository } from "../projects/project-repository.js";
import type { SourceVersionRepository } from "../sources/source-version-repository.js";
import type { ObjectStorage } from "../storage/object-storage.js";
import {
  InMemoryUploadFinalizationCommand,
  type UploadFinalizationCommand,
} from "./upload-finalization.js";
import {
  InMemoryUploadIntegrityFailureCommand,
  type UploadIntegrityFailureCommand,
} from "./upload-integrity-failure.js";
import type { UploadReconciliationMetrics } from "./upload-reconciliation-metrics.js";
import { UploadReconciler } from "./upload-reconciler.js";
import type { UploadRepository } from "./upload-repository.js";
import { UploadService } from "./upload-service.js";
import {
  InMemoryUploadCancellationCommand,
  type UploadCancellationCommand,
} from "./upload-cancellation.js";
import { UploadOperationLock } from "./upload-operation-lock.js";
import type { UploadScanQueueCommand } from "./upload-scan-queue.js";

export function createUploadRuntime(options: {
  uploads: UploadRepository;
  sourceVersions: SourceVersionRepository;
  projects: ProjectRepository;
  idempotency: IdempotencyStore;
  storage: ObjectStorage;
  maxUploadBytes: number;
  maxImageUploadBytes?: number;
  metrics: UploadReconciliationMetrics;
  logger: FastifyBaseLogger;
  finalization?: UploadFinalizationCommand;
  integrityFailures?: UploadIntegrityFailureCommand;
  cancellations?: UploadCancellationCommand;
  scanQueue?: UploadScanQueueCommand;
}) {
  const uploadOperations = new UploadOperationLock();
  const finalization =
    options.finalization ??
    new InMemoryUploadFinalizationCommand(
      options.uploads,
      options.sourceVersions,
      options.projects,
      () => new Date(),
      uploadOperations,
    );
  const integrityFailures =
    options.integrityFailures ??
    new InMemoryUploadIntegrityFailureCommand(
      options.uploads,
      options.sourceVersions,
      options.projects,
      () => new Date(),
      uploadOperations,
    );
  const cancellations =
    options.cancellations ??
    new InMemoryUploadCancellationCommand(
      options.uploads,
      options.sourceVersions,
      options.projects,
      () => new Date(),
      uploadOperations,
    );
  const service = new UploadService(
    options.uploads,
    () => new Date(),
    options.idempotency,
    options.storage,
    options.sourceVersions,
    finalization,
    options.maxUploadBytes,
    integrityFailures,
    cancellations,
    (error, context) => {
      options.logger.error(
        { err: error, ...context },
        "upload.operational_recovery_failed",
      );
    },
    options.maxImageUploadBytes ?? MAX_IMAGE_UPLOAD_BYTES,
    options.scanQueue,
  );
  const reconciler = new UploadReconciler(
    finalization,
    integrityFailures,
    options.storage,
    (report) => {
      options.metrics.observe(report);
      if (report.terminalFailed > 0) {
        options.logger.error(report, "upload.reconciliation_integrity_failure");
      } else if (report.transientFailed > 0) {
        options.logger.warn(report, "upload.reconciliation_transient_failure");
      } else if (report.inspected > 0) {
        options.logger.info(report, "upload.reconciliation_completed");
      }
    },
    60_000,
    (error) => {
      options.logger.error(
        { err: error },
        "upload.reconciliation_cycle_failed",
      );
    },
  );
  return { service, reconciler };
}
