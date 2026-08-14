import type {
  ProjectKind,
  ProjectStatus,
  ProjectSummary,
  SourceVersionRestoreEvent,
  SourceVersionRestoreResult,
} from "@motionprep/contracts";
import type { Pool, PoolClient } from "pg";
import {
  assertReplayMatches,
  type RestoreSourceVersionInput,
  SourceVersionRestoreDomainError,
  type SourceVersionRestoreCommand,
} from "../../sources/source-version-restore.js";
import { toIso } from "./database.js";
import { mapPostgresProject } from "./postgres-project-mapper.js";

interface ProjectRestoreRow {
  id: string;
  name: string;
  kind: ProjectKind;
  status: ProjectStatus;
  current_source_version_id: string | null;
  active_job_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TargetVersionRow {
  id: string;
  version_number: number;
  status: string;
}

interface RestoreEventRow {
  id: string;
  operation_id: string;
  project_id: string;
  actor_user_id: string;
  from_source_version_id: string;
  to_source_version_id: string;
  reason: string;
  request_id: string;
  idempotency_key: string;
  originating_request_id: string;
  created_at: Date | string;
}

export class PostgresSourceVersionRestoreCommand
  implements SourceVersionRestoreCommand
{
  constructor(private readonly pool: Pool) {}

  async restore(
    input: RestoreSourceVersionInput,
  ): Promise<SourceVersionRestoreResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [`source-restore:${input.actorUserId}:${input.idempotencyKey}`],
      );

      const existing = await findEventByIdempotencyKey(
        client,
        input.actorUserId,
        input.idempotencyKey,
      );
      if (existing) {
        const event = mapEvent(existing);
        assertReplayMatches(event, input);
        const { activeJobId: _activeJobId, ...project } =
          await findOwnedProject(client, input, false);
        await client.query("COMMIT");
        return { project, event, replayed: true };
      }

      // Serialize restore with source-version allocation. Upload intent creation
      // uses the same project-scoped advisory lock before publishing its
      // uploading source version.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [input.projectId],
      );

      const current = await findOwnedProject(client, input, true);
      if (
        current.activeJobId !== null ||
        current.status === "validating" ||
        current.status === "uploading" ||
        (await hasActiveUpload(client, input.projectId))
      ) {
        throw new SourceVersionRestoreDomainError(
          "SOURCE_VERSION_BUSY",
          "لا يمكن استعادة إصدار مصدر بينما توجد عملية رفع أو مهمة معالجة أو تصدير نشطة. انتظر اكتمالها أو ألغها ثم أعد المحاولة.",
        );
      }
      if (
        current.currentSourceVersionId !==
        input.expectedCurrentSourceVersionId
      ) {
        throw new SourceVersionRestoreDomainError(
          "SOURCE_VERSION_CONFLICT",
          "تغير إصدار المصدر الحالي. أعد تحميل سجل الإصدارات ثم حاول مجددًا.",
        );
      }
      if (current.currentSourceVersionId === input.targetSourceVersionId) {
        throw new SourceVersionRestoreDomainError(
          "SOURCE_VERSION_ALREADY_CURRENT",
          "إصدار المصدر المحدد هو الإصدار الحالي بالفعل.",
        );
      }

      const targetResult = await client.query<TargetVersionRow>(
        `
          SELECT id, version_number, status
          FROM source_versions
          WHERE id = $1 AND project_id = $2
        `,
        [input.targetSourceVersionId, input.projectId],
      );
      const target = targetResult.rows[0];
      if (!target) {
        throw new SourceVersionRestoreDomainError(
          "SOURCE_VERSION_NOT_FOUND",
          "إصدار المصدر المطلوب غير موجود.",
        );
      }
      if (target.status !== "ready") {
        throw new SourceVersionRestoreDomainError(
          "SOURCE_VERSION_NOT_READY",
          "لا يمكن استعادة إصدار مصدر غير مكتمل أو غير جاهز.",
        );
      }

      const event: SourceVersionRestoreEvent = {
        id: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
        projectId: input.projectId,
        actorUserId: input.actorUserId,
        fromSourceVersionId: input.expectedCurrentSourceVersionId,
        toSourceVersionId: input.targetSourceVersionId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        originatingRequestId: input.originatingRequestId,
        requestId: input.idempotencyKey,
        createdAt: new Date().toISOString(),
      };
      const updatedResult = await client.query<ProjectRestoreRow>(
        `
            UPDATE projects
            SET current_source_version_id = $2,
                status = 'needs_review',
                current_review_approval_id = NULL,
                updated_at = now()
          WHERE id = $1
            AND current_source_version_id = $3
            AND active_job_id IS NULL
            AND status NOT IN ('validating', 'uploading')
            AND NOT EXISTS (
              SELECT 1 FROM upload_sessions AS active_upload
              WHERE active_upload.project_id = projects.id
                AND active_upload.status IN ('validating', 'uploading', 'verifying')
                AND active_upload.expires_at > now()
            )
            AND NOT EXISTS (
              SELECT 1 FROM source_versions AS active_source
              WHERE active_source.project_id = projects.id
                AND active_source.status IN ('validating', 'uploading', 'verifying')
                AND active_source.updated_at > now() - interval '15 minutes'
            )
          RETURNING id, name, kind, status, current_source_version_id,
            active_job_id, created_at, updated_at
        `,
        [
          input.projectId,
          input.targetSourceVersionId,
          input.expectedCurrentSourceVersionId,
        ],
      );
      const updated = updatedResult.rows[0];
      if (!updated) {
        throw new SourceVersionRestoreDomainError(
          "SOURCE_VERSION_BUSY",
          "لا يمكن استعادة إصدار مصدر بينما توجد عملية رفع أو مهمة معالجة أو تصدير نشطة. انتظر اكتمالها أو ألغها ثم أعد المحاولة.",
        );
      }
      await client.query(
        `
          INSERT INTO source_version_restore_events (
            id, operation_id, project_id, actor_user_id,
            from_source_version_id, to_source_version_id, reason,
            request_id, idempotency_key, originating_request_id, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          event.id,
          event.operationId,
          event.projectId,
          event.actorUserId,
          event.fromSourceVersionId,
          event.toSourceVersionId,
          event.reason,
          event.requestId,
          event.idempotencyKey,
          event.originatingRequestId,
          event.createdAt,
        ],
      );
      await client.query("COMMIT");
      return {
        project: mapPostgresProject(updated, target.version_number),
        event,
        replayed: false,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async list(
    projectId: string,
    actorUserId: string,
    limit = 100,
  ): Promise<SourceVersionRestoreEvent[]> {
    const owner = await this.pool.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1 FROM projects
          WHERE id = $1 AND owner_user_id = $2
        ) AS exists
      `,
      [projectId, actorUserId],
    );
    if (!owner.rows[0]?.exists) {
      throw new SourceVersionRestoreDomainError(
        "PROJECT_NOT_FOUND",
        "المشروع غير موجود أو لا تملك صلاحية الوصول إليه.",
      );
    }
    const result = await this.pool.query<RestoreEventRow>(
      `
        SELECT ${restoreEventColumns}
        FROM source_version_restore_events
        WHERE project_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [projectId, Math.max(1, Math.min(limit, 200))],
    );
    return result.rows.map(mapEvent);
  }
}

async function hasActiveUpload(
  client: PoolClient,
  projectId: string,
): Promise<boolean> {
  const result = await client.query<{ busy: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM upload_sessions AS active_upload
       WHERE active_upload.project_id = $1
         AND active_upload.status IN ('validating', 'uploading', 'verifying')
         AND active_upload.expires_at > now()
       UNION ALL
       SELECT 1 FROM source_versions AS active_source
       WHERE active_source.project_id = $1
         AND active_source.status IN ('validating', 'uploading', 'verifying')
         AND active_source.updated_at > now() - interval '15 minutes'
     ) AS busy`,
    [projectId],
  );
  return result.rows[0]?.busy === true;
}

async function findOwnedProject(
  client: PoolClient,
  input: Pick<RestoreSourceVersionInput, "projectId" | "actorUserId">,
  lock: boolean,
): Promise<ProjectSummary & { activeJobId: string | null }> {
  const result = await client.query<ProjectRestoreRow>(
    `
      SELECT id, name, kind, status, current_source_version_id, active_job_id,
        created_at, updated_at
      FROM projects
      WHERE id = $1 AND owner_user_id = $2
      ${lock ? "FOR UPDATE" : ""}
    `,
    [input.projectId, input.actorUserId],
  );
  const row = result.rows[0];
  if (!row?.current_source_version_id) {
    throw new SourceVersionRestoreDomainError(
      "PROJECT_NOT_FOUND",
      "المشروع غير موجود أو لا يملك إصدار مصدر حاليًا.",
    );
  }
  const version = await client.query<{ version_number: number }>(
    "SELECT version_number FROM source_versions WHERE id = $1",
    [row.current_source_version_id],
  );
  return {
    ...mapPostgresProject(row, requiredRow(version.rows[0]).version_number),
    activeJobId: row.active_job_id,
  };
}

async function findEventByIdempotencyKey(
  client: PoolClient,
  actorUserId: string,
  idempotencyKey: string,
): Promise<RestoreEventRow | null> {
  const result = await client.query<RestoreEventRow>(
    `
      SELECT ${restoreEventColumns}
      FROM source_version_restore_events
      WHERE actor_user_id = $1 AND idempotency_key = $2
    `,
    [actorUserId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

function mapEvent(row: RestoreEventRow): SourceVersionRestoreEvent {
  return {
    id: row.id,
    operationId: row.operation_id,
    projectId: row.project_id,
    actorUserId: row.actor_user_id,
    fromSourceVersionId: row.from_source_version_id,
    toSourceVersionId: row.to_source_version_id,
    reason: row.reason,
    idempotencyKey: row.idempotency_key,
    originatingRequestId: row.originating_request_id,
    requestId: row.request_id,
    createdAt: toIso(row.created_at),
  };
}

const restoreEventColumns = `
  id, operation_id, project_id, actor_user_id, from_source_version_id,
  to_source_version_id, reason, request_id, idempotency_key,
  originating_request_id, created_at
`;

function requiredRow<T>(row: T | undefined): T {
  if (!row) throw new Error("PostgreSQL did not return the required row.");
  return row;
}
