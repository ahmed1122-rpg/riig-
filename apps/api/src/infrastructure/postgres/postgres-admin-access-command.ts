import type { Pool } from "pg";
import type { AdminAccessCommand } from "../../admin/admin-access-command.js";
import { AuditService } from "../../audit/audit-service.js";
import { AuthService } from "../../auth/auth-service.js";
import { PostgresAuditRepository } from "./postgres-audit-repository.js";
import { PostgresAuthRepository } from "./postgres-auth-repository.js";

export class PostgresAdminAccessCommand implements AdminAccessCommand {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async update(
    input: Parameters<AdminAccessCommand["update"]>[0],
  ): Promise<Awaited<ReturnType<AdminAccessCommand["update"]>>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const auth = new AuthService(
        new PostgresAuthRepository(client),
        this.now,
      );
      const audit = new AuditService(
        new PostgresAuditRepository(client),
        this.now,
      );
      const updated = await auth.updateUserAccess(
        input.actor,
        input.userId,
        input.changes,
      );
      await audit.record({
        actorUserId: input.actor.id,
        action: "admin.user.access_updated",
        targetType: "user",
        targetId: updated.id,
        outcome: "success",
        reason: input.reason,
        requestId: input.requestId,
      });
      await client.query("COMMIT");
      return updated;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
