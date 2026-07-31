import type { AuditEvent } from "@motionprep/contracts";
import type { Pool, PoolClient } from "pg";
import type { AuditRepository } from "../../audit/audit-repository.js";
import { toIso } from "./database.js";

interface AuditRow {
  id: string;
  actor_user_id: string;
  action: string;
  target_type: string;
  target_id: string;
  outcome: AuditEvent["outcome"];
  reason: string | null;
  request_id: string;
  created_at: Date | string;
}

export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly pool: Pool | PoolClient) {}

  async append(event: AuditEvent): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO audit_events (
          id, actor_user_id, action, target_type, target_id, outcome, reason,
          request_id, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        event.id,
        event.actorUserId,
        event.action,
        event.targetType,
        event.targetId,
        event.outcome,
        event.reason,
        event.requestId,
        event.createdAt,
      ],
    );
  }

  async list(limit: number): Promise<AuditEvent[]> {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const result = await this.pool.query<AuditRow>(
      `
        SELECT
          id, actor_user_id, action, target_type, target_id, outcome, reason,
          request_id, created_at
        FROM audit_events
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [safeLimit],
    );
    return result.rows.map(mapAudit);
  }
}

function mapAudit(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    outcome: row.outcome,
    reason: row.reason,
    requestId: row.request_id,
    createdAt: toIso(row.created_at),
  };
}
