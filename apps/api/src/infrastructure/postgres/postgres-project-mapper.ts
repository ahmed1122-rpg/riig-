import type {
  ProjectKind,
  ProjectStatus,
  ProjectSummary,
} from "@motionprep/contracts";
import { toIso } from "./database.js";

export interface PostgresProjectRow {
  id: string;
  name: string;
  kind: ProjectKind;
  status: ProjectStatus;
  current_source_version_id: string | null;
  current_source_version_number?: number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export function mapPostgresProject(
  row: PostgresProjectRow,
  currentSourceVersionNumber = row.current_source_version_number ?? null,
): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    currentSourceVersionId: row.current_source_version_id,
    currentSourceVersionNumber,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}
