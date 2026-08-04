import type { Pool } from "pg";
import type {
  IdempotencyClaim,
  IdempotencyStore,
} from "../../idempotency/idempotency-store.js";

interface ClaimRow {
  resource_id: string;
  request_hash: string | null;
}

export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly pool: Pool) {}

  async claim(
    namespace: string,
    key: string,
    resourceId: string,
    ttlSeconds: number,
  ): Promise<string> {
    const result = await this.upsertClaim(
      namespace,
      key,
      resourceId,
      null,
      ttlSeconds,
    );
    return result.resource_id;
  }

  async claimRequest(
    namespace: string,
    key: string,
    resourceId: string,
    requestHash: string,
    ttlSeconds: number,
  ): Promise<IdempotencyClaim> {
    const result = await this.upsertClaim(
      namespace,
      key,
      resourceId,
      requestHash,
      ttlSeconds,
    );
    if (result.resource_id === resourceId) {
      return { outcome: "claimed", resourceId };
    }
    if (result.request_hash !== null && result.request_hash !== requestHash) {
      return { outcome: "conflict", resourceId: result.resource_id };
    }
    return {
      outcome: "replayed",
      resourceId: result.resource_id,
      legacy: result.request_hash === null,
    };
  }

  private async upsertClaim(
    namespace: string,
    key: string,
    resourceId: string,
    requestHash: string | null,
    ttlSeconds: number,
  ): Promise<ClaimRow> {
    const result = await this.pool.query<ClaimRow>(
      `
        INSERT INTO idempotency_keys (
          namespace, idempotency_key, resource_id, request_hash, expires_at
        )
        VALUES ($1, $2, $3, $4, now() + ($5 * interval '1 second'))
        ON CONFLICT (namespace, idempotency_key) DO UPDATE SET
          resource_id = CASE
            WHEN idempotency_keys.expires_at <= now()
              THEN EXCLUDED.resource_id
            ELSE idempotency_keys.resource_id
          END,
          request_hash = CASE
            WHEN idempotency_keys.expires_at <= now()
              THEN EXCLUDED.request_hash
            ELSE idempotency_keys.request_hash
          END,
          expires_at = CASE
            WHEN idempotency_keys.expires_at <= now()
              THEN EXCLUDED.expires_at
            ELSE idempotency_keys.expires_at
          END
        RETURNING resource_id, request_hash
      `,
      [namespace, key, resourceId, requestHash, ttlSeconds],
    );
    const claimed = result.rows[0];
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
