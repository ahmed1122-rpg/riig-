import type { Pool } from "pg";
import type {
  ObjectWriteLease,
  ObjectWriteLeaseCoordinator,
  ObjectWriteScope,
} from "../../storage/leased-object-storage.js";
import { rollbackTransaction } from "./database.js";

export class PostgresObjectWriteLeaseCoordinator
  implements ObjectWriteLeaseCoordinator
{
  constructor(private readonly pool: Pool) {}

  async acquire(
    scope: ObjectWriteScope,
    objectKey: string,
    acquiredAt: string,
    expiresAt: string,
  ): Promise<ObjectWriteLease> {
    const client = await this.pool.connect();
    const lease: ObjectWriteLease = {
      id: crypto.randomUUID(),
      projectId: scope.projectId,
      objectKey,
    };
    try {
      await client.query("BEGIN");
      const owner = await client.query<{ owner_user_id: string }>(
        `SELECT owner.id AS owner_user_id
         FROM projects project
         JOIN users owner ON owner.id = project.owner_user_id
         WHERE project.id = $1
           AND owner.deletion_requested_at IS NULL
           AND owner.deleted_at IS NULL
         FOR KEY SHARE OF owner`,
        [scope.projectId],
      );
      const ownerUserId = owner.rows[0]?.owner_user_id;
      if (!ownerUserId) {
        throw new Error("Account deletion has disabled object writes.");
      }
      await client.query(
        `INSERT INTO object_write_leases (
         id, project_id, owner_user_id, object_key, writer_type,
           state, acquired_at, updated_at, expires_at
         ) VALUES (
           $1, $2, $3, $4, $5, 'writing', clock_timestamp(),
           clock_timestamp(),
           clock_timestamp() + ($7::timestamptz - $6::timestamptz)
         )`,
        [
          lease.id,
          scope.projectId,
          ownerUserId,
          objectKey,
          scope.writerType,
          acquiredAt,
          expiresAt,
        ],
      );
      await client.query("COMMIT");
      return lease;
    } catch (error) {
      await rollbackTransaction(client, error);
      throw error;
    } finally {
      client.release();
    }
  }

  async renew(
    lease: ObjectWriteLease,
    renewedAt: string,
    expiresAt: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE object_write_leases
       SET updated_at = clock_timestamp(),
           expires_at = clock_timestamp() + ($5::timestamptz - $4::timestamptz)
       WHERE id = $1 AND project_id = $2 AND object_key = $3
         AND state = 'writing' AND expires_at > clock_timestamp()
         AND $5::timestamptz > $4::timestamptz`,
      [lease.id, lease.projectId, lease.objectKey, renewedAt, expiresAt],
    );
    return result.rowCount === 1;
  }

  async cooldown(
    lease: ObjectWriteLease,
    completedAt: string,
    expiresAt: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE object_write_leases
       SET state = 'cooldown', updated_at = clock_timestamp(),
           expires_at = clock_timestamp() + ($5::timestamptz - $4::timestamptz)
       WHERE id = $1 AND project_id = $2 AND object_key = $3
         AND state = 'writing' AND expires_at > clock_timestamp()
         AND $5::timestamptz > $4::timestamptz`,
      [lease.id, lease.projectId, lease.objectKey, completedAt, expiresAt],
    );
    return result.rowCount === 1;
  }
}
