import type { Pool } from "pg";
import type { IdempotencyStore } from "../../idempotency/idempotency-store.js";

interface ClaimRow {
  resource_id: string;
}

export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly pool: Pool) {}

  async claim(
    namespace: string,
    key: string,
    resourceId: string,
    ttlSeconds: number,
  ): Promise<string> {
    const result = await this.pool.query<ClaimRow>(
      `
        INSERT INTO idempotency_keys (
          namespace, idempotency_key, resource_id, expires_at
        )
        VALUES ($1, $2, $3, now() + ($4 * interval '1 second'))
        ON CONFLICT (namespace, idempotency_key) DO UPDATE SET
          resource_id = CASE
            WHEN idempotency_keys.expires_at <= now()
              THEN EXCLUDED.resource_id
            ELSE idempotency_keys.resource_id
          END,
          expires_at = CASE
            WHEN idempotency_keys.expires_at <= now()
              THEN EXCLUDED.expires_at
            ELSE idempotency_keys.expires_at
          END
        RETURNING resource_id
      `,
      [namespace, key, resourceId, ttlSeconds],
    );
    const claimed = result.rows[0]?.resource_id;
    if (!claimed) throw new Error("Unable to claim idempotency key.");
    return claimed;
  }

  async release(
    namespace: string,
    key: string,
    resourceId: string,
  ): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM idempotency_keys
        WHERE namespace = $1
          AND idempotency_key = $2
          AND resource_id = $3
      `,
      [namespace, key, resourceId],
    );
  }
}
