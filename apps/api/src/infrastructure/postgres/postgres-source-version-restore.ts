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

interface ProjectRestoreRow {
  id: string;
  name: string;
  kind: ProjectKind;
  status: ProjectStatus;
  current_source_version_id: string | null;
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
  project_id: string;
  actor_user_id: string;
  from_source_version_id: string;
  to_source_version_id: string;
  reason: string;
  request_id: string;
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
        [`source-restore:${input.actorUserId}:${input.requestId}`],
      );

      const existing = await findEventByRequest(
        client,
        input.actorUserId,
        input.requestId,
      );
      if (existing) {
        const event = mapEvent(existing);
        assertReplayMatches(event, input);
        const project = await findOwnedProject(client, input, false);
        await client.query("COMMIT");
        return { project, event, replayed: true };
      }

      const current = await findOwnedProject(client, input, true);
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
        projectId: input.projectId,
        actorUserId: input.actorUserId,
        fromSourceVersionId: input.expectedCurrentSourceVersionId,
        toSourceVersionId: input.targetSourceVersionId,
        reason: input.reason,
        requestId: input.requestId,
        createdAt: new Date().toISOString(),
      };
      const updatedResult = await client.query<ProjectRestoreRow>(
        `
          UPDATE projects
          SET current_source_version_id = $2,
              status = 'needs_review',
              updated_at = now()
          WHERE id = $1
          RETURNING id, name, kind, status, current_source_version_id,
            created_at, updated_at
        `,
        [input.projectId, input.targetSourceVersionId],
      );
      await client.query(
        `
          INSERT INTO source_version_restore_events (
            id, project_id, actor_user_id, from_source_version_id,
            to_source_version_id, reason, request_id, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          event.id,
          event.projectId,
          event.actorUserId,
          event.fromSourceVersionId,
          event.toSourceVersionId,
          event.reason,
          event.requestId,
          event.createdAt,
        ],
      );
      await client.query("COMMIT");
      const updated = requiredRow(updatedResult.rows[0]);
      return {
        project: mapProject(updated, target.version_number),
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
        SELECT id, project_id, actor_user_id, from_source_version_id,
          to_source_version_id, reason, request_id, created_at
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

async function findOwnedProject(
  client: PoolClient,
  input: Pick<RestoreSourceVersionInput, "projectId" | "actorUserId">,
  lock: boolean,
): Promise<ProjectSummary> {
  const result = await client.query<ProjectRestoreRow>(
    `
      SELECT id, name, kind, status, current_source_version_id,
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
  return mapProject(row, requiredRow(version.rows[0]).version_number);
}

async function findEventByRequest(
  client: PoolClient,
  actorUserId: string,
  requestId: string,
): Promise<RestoreEventRow | null> {
  const result = await client.query<RestoreEventRow>(
    `
      SELECT id, project_id, actor_user_id, from_source_version_id,
        to_source_version_id, reason, request_id, created_at
      FROM source_version_restore_events
      WHERE actor_user_id = $1 AND request_id = $2
    `,
    [actorUserId, requestId],
  );
  return result.rows[0] ?? null;
}

function mapProject(
  row: ProjectRestoreRow,
  versionNumber: number,
): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    currentSourceVersionId: row.current_source_version_id,
    currentSourceVersionNumber: versionNumber,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapEvent(row: RestoreEventRow): SourceVersionRestoreEvent {
  return {
    id: row.id,
    projectId: row.project_id,
    actorUserId: row.actor_user_id,
    fromSourceVersionId: row.from_source_version_id,
    toSourceVersionId: row.to_source_version_id,
    reason: row.reason,
    requestId: row.request_id,
    createdAt: toIso(row.created_at),
  };
}

function requiredRow<T>(row: T | undefined): T {
  if (!row) throw new Error("PostgreSQL did not return the required row.");
  return row;
}
