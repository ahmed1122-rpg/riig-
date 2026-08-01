import type {
  ProcessingJob,
  ProcessingJobStatus,
  ProjectKind,
} from "@motionprep/contracts";
import {
  mapQueuedJobRow,
  type QueuedJobRow,
} from "./queued-job-row.js";

export interface ProcessingRow extends QueuedJobRow<ProcessingJobStatus> {
  id: string;
  correlation_id: string | null;
  project_id: string;
  source_version_id: string;
  project_kind: ProjectKind;
  options: ProcessingJob["options"];
}

export function mapProcessingRow(row: ProcessingRow): ProcessingJob {
  return {
    id: row.id,
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
    projectId: row.project_id,
    sourceVersionId: row.source_version_id,
    projectKind: row.project_kind,
    options: row.options,
    ...mapQueuedJobRow(row),
  };
}
