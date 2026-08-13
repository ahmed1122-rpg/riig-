import type {
  CreateProjectInput,
  ProjectReviewApproval,
  ProjectStatus,
  ProjectSummary,
} from "@motionprep/contracts";
import type { Pool } from "pg";
import type {
  ActiveProjectJob,
  ProjectRepository,
} from "../../projects/project-repository.js";
import {
  mapPostgresProject,
  type PostgresProjectRow,
} from "./postgres-project-mapper.js";

export class PostgresProjectRepository implements ProjectRepository {
  constructor(private readonly pool: Pool) {}

  async create(
    ownerUserId: string,
    input: CreateProjectInput,
  ): Promise<ProjectSummary> {
    const now = new Date().toISOString();
    const result = await this.pool.query<PostgresProjectRow>(
      `
        INSERT INTO projects (
          id, owner_user_id, name, kind, status, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, 'draft', $5, $5)
        RETURNING id, name, kind, status, current_source_version_id,
          NULL::integer AS current_source_version_number, created_at, updated_at
      `,
      [crypto.randomUUID(), ownerUserId, input.name, input.kind, now],
    );
    return mapPostgresProject(requiredRow(result.rows[0]));
  }

  async findOwnedById(
    ownerUserId: string,
    id: string,
  ): Promise<ProjectSummary | null> {
    const result = await this.pool.query<PostgresProjectRow>(
      `
        SELECT ${projectColumns}
        FROM projects AS project
        LEFT JOIN source_versions AS source
          ON source.id = project.current_source_version_id
        LEFT JOIN project_review_approvals AS approval
          ON approval.id = project.current_review_approval_id
        WHERE project.owner_user_id = $1 AND project.id = $2
      `,
      [ownerUserId, id],
    );
    return result.rows[0] ? mapPostgresProject(result.rows[0]) : null;
  }

  async findById(id: string): Promise<ProjectSummary | null> {
    const result = await this.pool.query<PostgresProjectRow>(
      `
        SELECT ${projectColumns}
        FROM projects AS project
        LEFT JOIN source_versions AS source
          ON source.id = project.current_source_version_id
        LEFT JOIN project_review_approvals AS approval
          ON approval.id = project.current_review_approval_id
        WHERE project.id = $1
      `,
      [id],
    );
    return result.rows[0] ? mapPostgresProject(result.rows[0]) : null;
  }

  async hasActiveJob(id: string): Promise<boolean> {
    const result = await this.pool.query<{ active: boolean }>(
      `SELECT active_job_id IS NOT NULL AS active
       FROM projects
       WHERE id = $1`,
      [id],
    );
    return result.rows[0]?.active === true;
  }

  async listOwnedByUser(ownerUserId: string): Promise<ProjectSummary[]> {
    const result = await this.pool.query<PostgresProjectRow>(
      `
        SELECT ${projectColumns}
        FROM projects AS project
        LEFT JOIN source_versions AS source
          ON source.id = project.current_source_version_id
        LEFT JOIN project_review_approvals AS approval
          ON approval.id = project.current_review_approval_id
        WHERE project.owner_user_id = $1
        ORDER BY project.updated_at DESC
      `,
      [ownerUserId],
    );
    return result.rows.map((row) => mapPostgresProject(row));
  }

  async deleteEmptyDraft(ownerUserId: string, id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM projects AS project
       WHERE project.id = $1
         AND project.owner_user_id = $2
         AND project.status = 'draft'
         AND project.current_source_version_id IS NULL
         AND project.active_job_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM upload_sessions AS upload
           WHERE upload.project_id = project.id
         )
       RETURNING project.id`,
      [id, ownerUserId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async updateStatus(
    id: string,
    status: ProjectStatus,
  ): Promise<ProjectSummary | null> {
    const result = await this.pool.query<PostgresProjectRow>(
      `
        WITH updated AS (
          UPDATE projects
          SET status = $2,
              current_review_approval_id = CASE
                WHEN $2 = 'needs_review' THEN NULL
                ELSE current_review_approval_id END,
              active_job_type = NULL,
              active_job_id = NULL,
              updated_at = now()
          WHERE id = $1
            AND active_job_id IS NULL
          ${updatedProjectResult()}
      `,
      [id, status],
    );
    return result.rows[0] ? mapPostgresProject(result.rows[0]) : null;
  }

  async updateStatusForSource(
    id: string,
    sourceVersionId: string,
    status: ProjectStatus,
    activeJob: ActiveProjectJob | null,
  ): Promise<ProjectSummary | null> {
    const result = await this.pool.query<PostgresProjectRow>(
      `
        WITH updated AS (
          UPDATE projects
          SET status = $3,
              current_review_approval_id = CASE
                WHEN $3 IN ('queued', 'processing', 'needs_review') THEN NULL
                ELSE current_review_approval_id END,
              active_job_type = $4,
              active_job_id = $5,
              updated_at = now()
          WHERE id = $1
            AND current_source_version_id = $2
            AND ($5::uuid IS NULL OR status NOT IN ('validating', 'uploading'))
            AND (
              active_job_id IS NULL
              OR (active_job_type = $4 AND active_job_id = $5)
            )
          ${updatedProjectResult()}
      `,
      [
        id,
        sourceVersionId,
        status,
        activeJob?.type ?? null,
        activeJob?.id ?? null,
      ],
    );
    return result.rows[0] ? mapPostgresProject(result.rows[0]) : null;
  }

  async applyReviewApproval(
    approval: ProjectReviewApproval,
  ): Promise<ProjectSummary | null> {
    const result = await this.pool.query<PostgresProjectRow>(
      `
        WITH updated AS (
          UPDATE projects AS project
          SET status = 'approved',
              current_review_approval_id = $4,
              active_job_type = NULL,
              active_job_id = NULL,
              updated_at = now()
          FROM layer_documents AS document
          WHERE project.id = $1
            AND project.current_source_version_id = $2
            AND project.active_job_id IS NULL
            AND project.status IN ('needs_review', 'approved', 'completed')
            AND document.project_id = project.id
            AND document.source_version_id = $2
            AND document.revision = $3
            AND EXISTS (
              SELECT 1 FROM project_review_approvals AS candidate
              WHERE candidate.id = $4
                AND candidate.project_id = project.id
                AND candidate.source_version_id = $2
                AND candidate.document_revision = $3
            )
          RETURNING project.*
        )
        SELECT
          updated.id, updated.name, updated.kind, updated.status,
          updated.current_source_version_id,
          source.version_number AS current_source_version_number,
          ${reviewApprovalColumns("current_approval")},
          updated.created_at, updated.updated_at
        FROM updated
        LEFT JOIN source_versions AS source
          ON source.id = updated.current_source_version_id
        LEFT JOIN project_review_approvals AS current_approval
          ON current_approval.id = updated.current_review_approval_id
      `,
      [
        approval.projectId,
        approval.sourceVersionId,
        approval.documentRevision,
        approval.id,
      ],
    );
    return result.rows[0] ? mapPostgresProject(result.rows[0]) : null;
  }

  async findCurrentReviewApproval(
    id: string,
  ): Promise<ProjectReviewApproval | null> {
    const result = await this.pool.query<PostgresProjectRow>(
      `SELECT project.id, project.name, project.kind, project.status,
         project.current_source_version_id,
         NULL::integer AS current_source_version_number,
         ${reviewApprovalColumns("approval")},
         project.created_at, project.updated_at
       FROM projects AS project
       LEFT JOIN project_review_approvals AS approval
         ON approval.id = project.current_review_approval_id
       WHERE project.id = $1`,
      [id],
    );
    return result.rows[0] ? mapPostgresProject(result.rows[0]).reviewApproval : null;
  }

  async invalidateReview(
    id: string,
    sourceVersionId: string,
  ): Promise<ProjectSummary | null> {
    const result = await this.pool.query<PostgresProjectRow>(
      `WITH updated AS (
         UPDATE projects
         SET current_review_approval_id = NULL,
             status = CASE
               WHEN active_job_id IS NULL THEN 'needs_review'
               ELSE status END,
             updated_at = now()
         WHERE id = $1 AND current_source_version_id = $2
         ${updatedProjectResult()}`,
      [id, sourceVersionId],
    );
    return result.rows[0] ? mapPostgresProject(result.rows[0]) : null;
  }

  async finishJobStatus(
    id: string,
    sourceVersionId: string,
    activeJob: ActiveProjectJob,
    status: ProjectStatus,
    documentRevision?: number,
  ): Promise<ProjectSummary | null> {
    const result = await this.pool.query<PostgresProjectRow>(
      `
        WITH updated AS (
          UPDATE projects
          SET status = CASE
                WHEN $3 <> 'export' THEN $5
                WHEN EXISTS (
                  SELECT 1
                  FROM project_review_approvals AS current_approval
                  WHERE current_approval.id = projects.current_review_approval_id
                    AND current_approval.source_version_id = $2
                    AND current_approval.document_revision = $6
                ) THEN CASE
                  WHEN $5 = 'completed' THEN 'completed'
                  ELSE 'approved'
                END
                ELSE 'needs_review'
              END,
              active_job_type = NULL,
              active_job_id = NULL,
              updated_at = now()
          WHERE id = $1
            AND current_source_version_id = $2
            AND active_job_type = $3
            AND active_job_id = $4
          ${updatedProjectResult()}
      `,
      [
        id,
        sourceVersionId,
        activeJob.type,
        activeJob.id,
        status,
        documentRevision ?? null,
      ],
    );
    return result.rows[0] ? mapPostgresProject(result.rows[0]) : null;
  }

  async updateCurrentSourceVersion(
    id: string,
    sourceVersionId: string,
    _versionNumber: number,
    requireIdle = false,
  ): Promise<ProjectSummary | null> {
    const result = await this.pool.query<PostgresProjectRow>(
      `
        WITH updated AS (
          UPDATE projects
          SET current_source_version_id = $2,
              current_review_approval_id = NULL,
              active_job_type = NULL,
              active_job_id = NULL,
              updated_at = now()
          WHERE id = $1
            AND (NOT $3::boolean OR active_job_id IS NULL)
          ${updatedProjectResult()}
      `,
      [id, sourceVersionId, requireIdle],
    );
    return result.rows[0] ? mapPostgresProject(result.rows[0]) : null;
  }

  async settleUploadCancellation(
    id: string,
    cancelledSourceVersionId: string,
    status: ProjectStatus,
  ): Promise<ProjectSummary | null> {
    const result = await this.pool.query<PostgresProjectRow>(
      `
        WITH updated AS (
          UPDATE projects
          SET status = $3,
              current_source_version_id = CASE
                WHEN current_source_version_id = $2 THEN NULL
                ELSE current_source_version_id END,
              current_review_approval_id = CASE
                WHEN current_source_version_id = $2 THEN NULL
                ELSE current_review_approval_id END,
              active_job_type = NULL,
              active_job_id = NULL,
              updated_at = now()
          WHERE id = $1
            AND status IN ('validating', 'uploading')
          ${updatedProjectResult()}
      `,
      [id, cancelledSourceVersionId, status],
    );
    return result.rows[0] ? mapPostgresProject(result.rows[0]) : null;
  }
}

const projectColumns = `
  project.id, project.name, project.kind, project.status,
  project.current_source_version_id,
  source.version_number AS current_source_version_number,
  ${reviewApprovalColumns("approval")},
  project.created_at, project.updated_at
`;

function updatedProjectResult(): string {
  return `
    RETURNING *
  )
  SELECT
    updated.id, updated.name, updated.kind, updated.status,
    updated.current_source_version_id,
    source.version_number AS current_source_version_number,
    ${reviewApprovalColumns("approval")},
    updated.created_at, updated.updated_at
  FROM updated
  LEFT JOIN source_versions AS source
    ON source.id = updated.current_source_version_id
  LEFT JOIN project_review_approvals AS approval
    ON approval.id = updated.current_review_approval_id
  `;
}

function reviewApprovalColumns(alias: string): string {
  return `
    ${alias}.id AS review_approval_id,
    ${alias}.project_id AS review_project_id,
    ${alias}.source_version_id AS review_source_version_id,
    ${alias}.document_revision AS review_document_revision,
    ${alias}.actor_user_id AS review_actor_user_id,
    ${alias}.operation_id AS review_operation_id,
    ${alias}.approved_at AS review_approved_at
  `;
}

function requiredRow<T>(row: T | undefined): T {
  if (!row) throw new Error("PostgreSQL did not return the inserted project.");
  return row;
}
