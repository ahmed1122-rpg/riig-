import type { PoolClient } from "pg";

export async function collectAccountObjectPrefixes(
  client: PoolClient,
  userId: string,
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    "SELECT id FROM projects WHERE owner_user_id = $1 ORDER BY id",
    [userId],
  );
  return result.rows.flatMap(({ id }) => [
    `sources/${encodeURIComponent(id)}/`,
    `artifacts/${encodeURIComponent(id)}/`,
    `derived/${encodeURIComponent(id)}/`,
    `projects/${encodeURIComponent(id)}/`,
  ]);
}

export async function collectAccountObjectKeys(
  client: PoolClient,
  userId: string,
): Promise<string[]> {
  const result = await client.query<{ object_key: string }>(
    `SELECT DISTINCT object_key FROM (
       SELECT upload.object_key FROM upload_sessions upload
       JOIN projects project ON project.id = upload.project_id
       WHERE project.owner_user_id = $1
       UNION ALL
       SELECT job.artifact->>'objectKey' FROM export_jobs job
       JOIN projects project ON project.id = job.project_id
       WHERE project.owner_user_id = $1 AND job.artifact ? 'objectKey'
       UNION ALL
       SELECT value #>> '{}' FROM layer_documents record
       JOIN projects project ON project.id = record.project_id,
         LATERAL jsonb_path_query(record.document, '$.**.objectKey') value
       WHERE project.owner_user_id = $1
       UNION ALL
       SELECT value #>> '{}' FROM layer_document_revisions record
       JOIN projects project ON project.id = record.project_id,
         LATERAL jsonb_path_query(record.document, '$.**.objectKey') value
       WHERE project.owner_user_id = $1
       UNION ALL
       SELECT value #>> '{}' FROM character_reference_assets record
       JOIN projects project ON project.id = record.project_id,
         LATERAL jsonb_path_query(record.document, '$.**.objectKey') value
       WHERE project.owner_user_id = $1
       UNION ALL
       SELECT value #>> '{}' FROM character_generation_attempts record
       JOIN projects project ON project.id = record.project_id,
         LATERAL jsonb_path_query(record.document, '$.**.objectKey') value
       WHERE project.owner_user_id = $1
       UNION ALL
       SELECT value #>> '{}' FROM character_rig_versions record
       JOIN projects project ON project.id = record.project_id,
         LATERAL jsonb_path_query(record.document, '$.**.objectKey') value
       WHERE project.owner_user_id = $1
       UNION ALL
       SELECT value #>> '{}' FROM character_jobs record
       JOIN projects project ON project.id = record.project_id,
         LATERAL jsonb_path_query(record.document, '$.**.objectKey') value
       WHERE project.owner_user_id = $1
       UNION ALL
       SELECT registry.object_key FROM derived_asset_registry registry
       WHERE registry.owner_user_id = $1 AND registry.purged_at IS NULL
     ) owned WHERE object_key IS NOT NULL AND object_key <> ''`,
    [userId],
  );
  return result.rows.map((row) => row.object_key);
}

export async function purgeAccountGraph(
  client: PoolClient,
  userId: string,
  email: string,
  completedAt: string,
): Promise<void> {
  await client.query(
    `SELECT id FROM projects WHERE owner_user_id = $1 ORDER BY id FOR UPDATE`,
    [userId],
  );
  await client.query(
    `SELECT object_key FROM derived_asset_registry
     WHERE owner_user_id = $1 ORDER BY object_key FOR UPDATE`,
    [userId],
  );
  await client.query(
    "DELETE FROM derived_asset_registry WHERE owner_user_id = $1",
    [userId],
  );
  await client.query("DELETE FROM projects WHERE owner_user_id = $1", [userId]);
  await client.query("DELETE FROM email_verification_tokens WHERE user_id = $1", [
    userId,
  ]);
  await client.query("DELETE FROM email_outbox WHERE recipient = $1", [email]);
  await client.query(
    `UPDATE subscriptions SET provider_customer_id = NULL,
         provider_subscription_id = NULL WHERE user_id = $1`,
    [userId],
  );
  await client.query(
    `UPDATE checkout_sessions SET provider_reference = NULL,
       checkout_url = NULL WHERE user_id = $1`,
    [userId],
  );
  await client.query(
    `UPDATE users SET name = 'Deleted account',
       email = lower('deleted+' || id::text || '@deleted.invalid'),
       status = 'suspended', password_hash = '!deleted!', last_login_at = NULL,
       mfa_enabled = false, mfa_secret_ciphertext = NULL,
       recovery_code_hashes = '{}', deleted_at = $2
     WHERE id = $1`,
    [userId, completedAt],
  );
}
