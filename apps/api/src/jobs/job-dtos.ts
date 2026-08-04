import type {
  AdminExportJobDto,
  AdminJobOperationsDto,
  AdminProcessingJobDto,
  ExportJob,
  ExportJobDto,
  ProcessingJob,
  ProcessingJobDto,
  ProcessingJobOptionsDto,
} from "@motionprep/contracts";

export function toExportJobDto(job: ExportJob): ExportJobDto {
  return {
    id: job.id,
    projectId: job.projectId,
    sourceVersionId: job.sourceVersionId,
    ...(job.documentRevision === undefined
      ? {}
      : { documentRevision: job.documentRevision }),
    projectKind: job.projectKind,
    format: job.format,
    scope: job.scope,
    ...(job.selectedPage === undefined
      ? {}
      : { selectedPage: job.selectedPage }),
    scale: job.scale,
    colorProfile: job.colorProfile,
    namingPresetId: job.namingPresetId,
    status: job.status,
    progress: job.progress,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    errorCode: job.errorCode,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.artifact
      ? {
          artifact: {
            filename: job.artifact.filename,
            sizeBytes: job.artifact.sizeBytes,
            sha256: job.artifact.sha256,
            expiresAt: job.artifact.expiresAt,
          },
        }
      : {}),
  };
}

export function toProcessingJobDto(job: ProcessingJob): ProcessingJobDto {
  return {
    id: job.id,
    projectId: job.projectId,
    sourceVersionId: job.sourceVersionId,
    projectKind: job.projectKind,
    options: toProcessingOptionsDto(job.options),
    status: job.status,
    progress: job.progress,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    errorCode: job.errorCode,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export function toAdminExportJobDto(job: ExportJob): AdminExportJobDto {
  const projected = toExportJobDto(job);
  const { attempt, maxAttempts, errorCode, ...details } = projected;
  return {
    ...details,
    ...toAdminOperationsDto(job, attempt, maxAttempts, errorCode),
  };
}

export function toAdminProcessingJobDto(
  job: ProcessingJob,
): AdminProcessingJobDto {
  const projected = toProcessingJobDto(job);
  const { attempt, maxAttempts, errorCode, ...details } = projected;
  return {
    ...details,
    ...toAdminOperationsDto(job, attempt, maxAttempts, errorCode),
  };
}

function toProcessingOptionsDto(
  options: ProcessingJob["options"],
): ProcessingJobOptionsDto {
  return {
    ...(options.pdfSeparationMode
      ? { pdfSeparationMode: options.pdfSeparationMode }
      : {}),
    ...(options.pdfRegionOcr
      ? {
          pdfRegionOcr: {
            pageNumber: options.pdfRegionOcr.pageNumber,
            start: options.pdfRegionOcr.start,
            end: options.pdfRegionOcr.end,
            baseRevision: options.pdfRegionOcr.baseRevision,
          },
        }
      : {}),
  };
}

function toAdminOperationsDto(
  job: Pick<
    ExportJob | ProcessingJob,
    | "correlationId"
    | "traceContext"
    | "nextAttemptAt"
    | "leaseOwner"
    | "leaseExpiresAt"
  >,
  attempt: number,
  maxAttempts: number,
  errorCode: string | null,
): AdminJobOperationsDto {
  return {
    correlationId: job.correlationId ?? null,
    traceId: traceIdFrom(job.traceContext?.traceparent),
    attempt: {
      current: attempt,
      maximum: maxAttempts,
      nextAt: job.nextAttemptAt,
    },
    error: errorCode ? { code: errorCode } : null,
    lease:
      job.leaseOwner || job.leaseExpiresAt
        ? { owner: job.leaseOwner, expiresAt: job.leaseExpiresAt }
        : null,
  };
}

function traceIdFrom(traceparent: string | undefined): string | null {
  return traceparent?.split("-")[1] ?? null;
}
