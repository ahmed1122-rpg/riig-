import type {
  LayerDocument,
  ProjectKind,
  ProjectReviewApproval,
  ProjectReviewApprovalResult,
  ProjectStatus,
} from "@motionprep/contracts";
import { validateProductionDocument } from "@motionprep/presets";
import type { Pool, PoolClient } from "pg";
import {
  assertReviewReplayMatches,
  type ApproveProjectReviewInput,
  ProjectReviewDomainError,
  type ProjectReviewCommand,
} from "../../projects/project-review.js";
import { mapPostgresProject } from "./postgres-project-mapper.js";

interface ApprovalRow {
  id: string;
  project_id: string;
  source_version_id: string;
  document_revision: number;
  actor_user_id: string;
  operation_id: string;
  approved_at: Date | string;
}

interface LockedProjectRow {
  id: string;
  name: string;
  kind: ProjectKind;
  status: ProjectStatus;
  current_source_version_id: string | null;
  current_source_version_number: number | null;
  active_job_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DocumentRow {
  revision: number;
  document: LayerDocument;
}

export class PostgresProjectReviewCommand implements ProjectReviewCommand {
  constructor(private readonly pool: Pool) {}

  async approve(
    input: ApproveProjectReviewInput,
  ): Promise<ProjectReviewApprovalResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [`project-review:${input.actorUserId}:${input.operationId}`],
      );

      const replay = await findByOperation(
        client,
        input.actorUserId,
        input.operationId,
      );
      if (replay) {
        const approval = mapApproval(replay);
        assertReviewReplayMatches(approval, input);
        const project = await requireOwnedProject(client, input, false);
        await client.query("COMMIT");
        return { project, approval, replayed: true };
      }

      const project = await lockOwnedProject(client, input);
      if (project.current_source_version_id !== input.sourceVersionId) {
        throw domainError(
          "REVIEW_SOURCE_CONFLICT",
          "تغير إصدار المصدر الحالي قبل اعتماد المراجعة.",
        );
      }
      if (
        project.active_job_id !== null ||
        !["needs_review", "approved", "completed"].includes(project.status)
      ) {
        throw domainError(
          "REVIEW_STATE_CONFLICT",
          "لا يمكن اعتماد المراجعة أثناء وجود عملية نشطة أو في حالة المشروع الحالية.",
        );
      }

      const documentResult = await client.query<DocumentRow>(
        `SELECT revision, document
         FROM layer_documents
         WHERE project_id = $1 AND source_version_id = $2
         FOR UPDATE`,
        [input.projectId, input.sourceVersionId],
      );
      const document = documentResult.rows[0];
      if (!document) {
        throw domainError(
          "REVIEW_DOCUMENT_NOT_READY",
          "وثيقة الطبقات غير جاهزة للاعتماد.",
        );
      }
      if (document.revision !== input.documentRevision) {
        throw domainError(
          "REVIEW_REVISION_CONFLICT",
          "تغيرت وثيقة الطبقات قبل اعتماد المراجعة.",
        );
      }
      const issues = validateProductionDocument(document.document, project.kind);
      if (issues.length > 0) {
        throw new ProjectReviewDomainError(
          "REVIEW_PREFLIGHT_FAILED",
          issues[0]?.message ?? "فشل فحص وثيقة الطبقات.",
          issues,
        );
      }

      const approval: ProjectReviewApproval = {
        id: crypto.randomUUID(),
        projectId: input.projectId,
        sourceVersionId: input.sourceVersionId,
        documentRevision: input.documentRevision,
        actorUserId: input.actorUserId,
        operationId: input.operationId,
        approvedAt: new Date().toISOString(),
      };
      await client.query(
        `INSERT INTO project_review_approvals (
           id, project_id, source_version_id, document_revision,
           actor_user_id, operation_id, approved_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          approval.id,
          approval.projectId,
          approval.sourceVersionId,
          approval.documentRevision,
          approval.actorUserId,
          approval.operationId,
          approval.approvedAt,
        ],
      );
      const updated = await client.query<LockedProjectRow>(
        `UPDATE projects AS project
         SET status = 'approved',
             current_review_approval_id = $4,
             updated_at = now()
         WHERE project.id = $1
           AND project.current_source_version_id = $2
           AND project.active_job_id IS NULL
           AND EXISTS (
             SELECT 1 FROM layer_documents AS document
             WHERE document.project_id = project.id
               AND document.source_version_id = $2
               AND document.revision = $3
           )
         RETURNING project.id, project.name, project.kind, project.status,
           project.current_source_version_id,
           NULL::integer AS current_source_version_number,
           project.active_job_id, project.created_at, project.updated_at`,
        [
          input.projectId,
          input.sourceVersionId,
          input.documentRevision,
          approval.id,
        ],
      );
      if (!updated.rows[0]) {
        throw domainError(
          "REVIEW_STATE_CONFLICT",
          "تغيرت حالة المشروع قبل اعتماد المراجعة.",
        );
      }
      await client.query("COMMIT");
      return {
        project: mapPostgresProject(
          { ...updated.rows[0], ...approvalColumns(approval) },
          project.current_source_version_number,
        ),
        approval,
        replayed: false,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findCurrent(projectId: string): Promise<ProjectReviewApproval | null> {
    const result = await this.pool.query<ApprovalRow>(
      `SELECT approval.*
       FROM projects AS project
       JOIN project_review_approvals AS approval
         ON approval.id = project.current_review_approval_id
       WHERE project.id = $1`,
      [projectId],
    );
    return result.rows[0] ? mapApproval(result.rows[0]) : null;
  }
}

async function findByOperation(
  client: PoolClient,
  actorUserId: string,
  operationId: string,
): Promise<ApprovalRow | null> {
  const result = await client.query<ApprovalRow>(
    `SELECT * FROM project_review_approvals
     WHERE actor_user_id = $1 AND operation_id = $2`,
    [actorUserId, operationId],
  );
  return result.rows[0] ?? null;
}

async function lockOwnedProject(
  client: PoolClient,
  input: ApproveProjectReviewInput,
): Promise<LockedProjectRow> {
  const result = await client.query<LockedProjectRow>(
    `SELECT project.id, project.name, project.kind, project.status,
       project.current_source_version_id,
       source.version_number AS current_source_version_number,
       project.active_job_id, project.created_at, project.updated_at
     FROM projects AS project
     LEFT JOIN source_versions AS source
       ON source.id = project.current_source_version_id
     WHERE project.id = $1 AND project.owner_user_id = $2
     FOR UPDATE OF project`,
    [input.projectId, input.actorUserId],
  );
  if (!result.rows[0]) {
    throw domainError(
      "PROJECT_NOT_FOUND",
      "المشروع غير موجود أو لا تملك صلاحية الوصول إليه.",
    );
  }
  return result.rows[0];
}

async function requireOwnedProject(
  client: PoolClient,
  input: ApproveProjectReviewInput,
  lock: boolean,
) {
  const result = await client.query<LockedProjectRow & ReturnType<typeof approvalColumns>>(
    `SELECT project.id, project.name, project.kind, project.status,
       project.current_source_version_id,
       source.version_number AS current_source_version_number,
       project.active_job_id, project.created_at, project.updated_at,
       approval.id AS review_approval_id,
       approval.project_id AS review_project_id,
       approval.source_version_id AS review_source_version_id,
       approval.document_revision AS review_document_revision,
       approval.actor_user_id AS review_actor_user_id,
       approval.operation_id AS review_operation_id,
       approval.approved_at AS review_approved_at
     FROM projects AS project
     LEFT JOIN source_versions AS source
       ON source.id = project.current_source_version_id
     LEFT JOIN project_review_approvals AS approval
       ON approval.id = project.current_review_approval_id
     WHERE project.id = $1 AND project.owner_user_id = $2
     ${lock ? "FOR UPDATE OF project" : ""}`,
    [input.projectId, input.actorUserId],
  );
  const row = result.rows[0];
  if (!row) {
    throw domainError(
      "PROJECT_NOT_FOUND",
      "المشروع غير موجود أو لا تملك صلاحية الوصول إليه.",
    );
  }
  return mapPostgresProject(row, row.current_source_version_number);
}

function mapApproval(row: ApprovalRow): ProjectReviewApproval {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceVersionId: row.source_version_id,
    documentRevision: row.document_revision,
    actorUserId: row.actor_user_id,
    operationId: row.operation_id,
    approvedAt: new Date(row.approved_at).toISOString(),
  };
}

function approvalColumns(approval: ProjectReviewApproval) {
  return {
    review_approval_id: approval.id,
    review_project_id: approval.projectId,
    review_source_version_id: approval.sourceVersionId,
    review_document_revision: approval.documentRevision,
    review_actor_user_id: approval.actorUserId,
    review_operation_id: approval.operationId,
    review_approved_at: approval.approvedAt,
  };
}

function domainError(
  code: ConstructorParameters<typeof ProjectReviewDomainError>[0],
  message: string,
) {
  return new ProjectReviewDomainError(code, message);
}
