import type {
  ProjectKind,
  ProjectReviewApproval,
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
  review_approval_id?: string | null;
  review_project_id?: string | null;
  review_source_version_id?: string | null;
  review_document_revision?: number | null;
  review_actor_user_id?: string | null;
  review_operation_id?: string | null;
  review_approved_at?: Date | string | null;
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
    reviewApproval: mapReviewApproval(row),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapReviewApproval(
  row: PostgresProjectRow,
): ProjectReviewApproval | null {
  if (
    !row.review_approval_id ||
    !row.review_project_id ||
    !row.review_source_version_id ||
    !row.review_document_revision ||
    !row.review_actor_user_id ||
    !row.review_operation_id ||
    !row.review_approved_at
  ) {
    return null;
  }
  return {
    id: row.review_approval_id,
    projectId: row.review_project_id,
    sourceVersionId: row.review_source_version_id,
    documentRevision: row.review_document_revision,
    actorUserId: row.review_actor_user_id,
    operationId: row.review_operation_id,
    approvedAt: toIso(row.review_approved_at),
  };
}
