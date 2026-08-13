import type { ExportJob, ExportJobStatus } from "@motionprep/contracts";
import { mapQueuedJobRow, type QueuedJobRow } from "./queued-job-row.js";

export interface ExportRow extends QueuedJobRow<ExportJobStatus> {
  id: string;
  correlation_id: string | null;
  trace_parent: string | null;
  trace_state: string | null;
  project_id: string;
  source_version_id: string;
  document_revision: number;
  project_kind: ExportJob["projectKind"];
  format: ExportJob["format"];
  scope: ExportJob["scope"];
  selected_page: number | null;
  scale: ExportJob["scale"];
  color_profile: ExportJob["colorProfile"];
  naming_preset_id: string;
  artifact: ExportJob["artifact"] | null;
}

export function mapExportRow(row: ExportRow): ExportJob {
  return {
    id: row.id,
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
    ...(row.trace_parent
      ? {
          traceContext: {
            traceparent: row.trace_parent,
            ...(row.trace_state ? { tracestate: row.trace_state } : {}),
          },
        }
      : {}),
    projectId: row.project_id,
    sourceVersionId: row.source_version_id,
    documentRevision: row.document_revision,
    projectKind: row.project_kind,
    format: row.format,
    scope: row.scope,
    ...(row.selected_page === null
      ? {}
      : { selectedPage: row.selected_page }),
    scale: row.scale,
    colorProfile: row.color_profile,
    namingPresetId: row.naming_preset_id,
    ...mapQueuedJobRow(row),
    ...(row.artifact ? { artifact: row.artifact } : {}),
  };
}
