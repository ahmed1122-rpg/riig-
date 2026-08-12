import type { Pool, PoolClient } from "pg";
import type { CharacterJobResult } from "../../character-rig/character-job-result-committer.js";
import type { CharacterJobResultCommitter } from "../../character-rig/character-job-result-committer.js";
import { rollbackTransaction } from "./database.js";

export class PostgresCharacterJobResultCommitter
  implements CharacterJobResultCommitter
{
  constructor(private readonly pool: Pool) {}

  async commit(
    jobId: string,
    workerId: string,
    completedAt: string,
    result: CharacterJobResult,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const owned = await client.query<{ project_id: string }>(
        `SELECT project_id FROM character_jobs
         WHERE id = $1 AND lease_owner = $2
           AND status IN ('processing', 'verifying')
           AND lease_expires_at > $3::timestamptz
         FOR UPDATE`,
        [jobId, workerId, completedAt],
      );
      const projectId = owned.rows[0]?.project_id;
      if (!projectId || projectId !== resultProjectId(result)) {
        await client.query("ROLLBACK");
        return false;
      }

      const saved = await persistResult(client, result);
      if (!saved) {
        await client.query("ROLLBACK");
        return false;
      }
      const completed = await client.query(
        `UPDATE character_jobs
         SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
             error_code = NULL, updated_at = $3::timestamptz,
             document = document || jsonb_build_object(
               'status', 'succeeded', 'leaseOwner', NULL,
               'leaseExpiresAt', NULL, 'errorCode', NULL,
               'updatedAt', $3::timestamptz::text
             )
         WHERE id = $1 AND lease_owner = $2
         RETURNING id`,
        [jobId, workerId, completedAt],
      );
      if (completed.rowCount !== 1) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await rollbackTransaction(client, error);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function persistResult(
  client: PoolClient,
  result: CharacterJobResult,
): Promise<boolean> {
  if (result.kind === "identity-model") {
    const saved = await client.query(
      `UPDATE character_identity_model_versions
       SET status = $3, provider_key = $4, document = $5::jsonb,
           updated_at = $6::timestamptz
       WHERE id = $1 AND project_id = $2
       RETURNING id`,
      [
        result.model.id,
        result.model.projectId,
        result.model.status,
        result.model.providerKey,
        JSON.stringify(result.model),
        result.model.updatedAt,
      ],
    );
    return saved.rowCount === 1;
  }
  if (result.kind === "generation") {
    const saved = await client.query(
      `UPDATE character_generation_attempts
       SET status = $3, document = $4::jsonb, updated_at = $5::timestamptz
       WHERE id = $1 AND project_id = $2
       RETURNING id`,
      [
        result.attempt.id,
        result.attempt.projectId,
        result.attempt.status,
        JSON.stringify(result.attempt),
        result.attempt.updatedAt,
      ],
    );
    return saved.rowCount === 1;
  }
  const saved = await client.query(
    `UPDATE character_rig_versions
     SET status = $3, document = $4::jsonb, approved_by_user_id = $5,
         approved_at = $6, updated_at = $7::timestamptz
     WHERE id = $1 AND project_id = $2
     RETURNING id`,
    [
      result.rig.id,
      result.rig.projectId,
      result.rig.status,
      JSON.stringify(result.rig),
      result.rig.approvedByUserId,
      result.rig.approvedAt,
      result.rig.updatedAt,
    ],
  );
  return saved.rowCount === 1;
}

function resultProjectId(result: CharacterJobResult): string {
  return result.kind === "identity-model"
    ? result.model.projectId
    : result.kind === "generation"
      ? result.attempt.projectId
      : result.rig.projectId;
}
