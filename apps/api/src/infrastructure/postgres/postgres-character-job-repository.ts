import type { CharacterJob } from "@motionprep/contracts";
import type { Pool } from "pg";
import type { CharacterJobRepository } from "../../character-rig/character-job-repository.js";

interface CharacterJobRow {
  id: string;
  project_id: string;
  type: CharacterJob["type"];
  status: CharacterJob["status"];
  operation_key: string;
  request_hash: string;
  document: CharacterJob;
  attempt: number;
  max_attempts: number;
  next_attempt_at: Date | string;
  lease_owner: string | null;
  lease_expires_at: Date | string | null;
  error_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export class PostgresCharacterJobRepository implements CharacterJobRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<CharacterJob | null> {
    const result = await this.pool.query<CharacterJobRow>(
      `${characterJobSelect} WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapCharacterJobRow(result.rows[0]) : null;
  }

  async findByOperationKey(
    projectId: string,
    operationKey: string,
  ): Promise<CharacterJob | null> {
    const result = await this.pool.query<CharacterJobRow>(
      `${characterJobSelect} WHERE project_id = $1 AND operation_key = $2`,
      [projectId, operationKey],
    );
    return result.rows[0] ? mapCharacterJobRow(result.rows[0]) : null;
  }

  async save(job: CharacterJob): Promise<void> {
    await this.pool.query(
      `INSERT INTO character_jobs (
         id, project_id, type, status, operation_key, request_hash, document,
         attempt, max_attempts, next_attempt_at, lease_owner, lease_expires_at,
         error_code, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15
       )
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         document = EXCLUDED.document,
         attempt = EXCLUDED.attempt,
         max_attempts = EXCLUDED.max_attempts,
         next_attempt_at = EXCLUDED.next_attempt_at,
         lease_owner = EXCLUDED.lease_owner,
         lease_expires_at = EXCLUDED.lease_expires_at,
         error_code = EXCLUDED.error_code,
         updated_at = EXCLUDED.updated_at
       WHERE character_jobs.project_id = EXCLUDED.project_id
         AND character_jobs.type = EXCLUDED.type
         AND character_jobs.operation_key = EXCLUDED.operation_key
         AND character_jobs.request_hash = EXCLUDED.request_hash`,
      [
        job.id,
        job.projectId,
        job.type,
        job.status,
        job.operationKey,
        job.requestHash,
        JSON.stringify(job),
        job.attempt,
        job.maxAttempts,
        job.nextAttemptAt,
        job.leaseOwner,
        job.leaseExpiresAt,
        job.errorCode,
        job.createdAt,
        job.updatedAt,
      ],
    );
  }

  async claimNext(
    workerId: string,
    claimedAt: string,
    leaseExpiresAt: string,
  ): Promise<CharacterJob | null> {
    const result = await this.pool.query<CharacterJobRow>(
      `WITH candidate AS (
         SELECT id FROM character_jobs
         WHERE attempt < max_attempts
           AND (
             (status = 'queued' AND next_attempt_at <= $2)
             OR (status IN ('processing', 'verifying') AND lease_expires_at <= $2)
           )
         ORDER BY next_attempt_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE character_jobs AS job
       SET status = 'processing',
           attempt = job.attempt + 1,
           lease_owner = $1,
           lease_expires_at = $3,
           error_code = NULL,
           updated_at = $2,
           document = job.document || jsonb_build_object(
             'status', 'processing',
             'attempt', job.attempt + 1,
             'leaseOwner', $1::text,
             'leaseExpiresAt', $3::text,
             'errorCode', NULL,
             'updatedAt', $2::text
           )
       FROM candidate
       WHERE job.id = candidate.id
       RETURNING ${characterJobReturning}`,
      [workerId, claimedAt, leaseExpiresAt],
    );
    return result.rows[0] ? mapCharacterJobRow(result.rows[0]) : null;
  }

  async renewClaim(
    id: string,
    workerId: string,
    renewedAt: string,
    leaseExpiresAt: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE character_jobs
       SET lease_expires_at = $4,
           updated_at = $3,
           document = document || jsonb_build_object(
             'leaseExpiresAt', $4::text,
             'updatedAt', $3::text
           )
       WHERE id = $1
         AND lease_owner = $2
         AND status IN ('processing', 'verifying')
         AND lease_expires_at > $3`,
      [id, workerId, renewedAt, leaseExpiresAt],
    );
    return result.rowCount === 1;
  }

  async completeClaim(
    id: string,
    workerId: string,
    completedAt: string,
  ): Promise<CharacterJob | null> {
    const result = await this.pool.query<CharacterJobRow>(
      `UPDATE character_jobs
       SET status = 'succeeded',
           lease_owner = NULL,
           lease_expires_at = NULL,
           error_code = NULL,
           updated_at = $3,
           document = document || jsonb_build_object(
             'status', 'succeeded',
             'leaseOwner', NULL,
             'leaseExpiresAt', NULL,
             'errorCode', NULL,
             'updatedAt', $3::text
           )
       WHERE id = $1
         AND lease_owner = $2
         AND status IN ('processing', 'verifying')
         AND lease_expires_at > $3
       RETURNING ${characterJobReturning}`,
      [id, workerId, completedAt],
    );
    return result.rows[0] ? mapCharacterJobRow(result.rows[0]) : null;
  }

  async retryOrFailClaim(
    id: string,
    workerId: string,
    errorCode: string,
    nextAttemptAt: string,
    updatedAt: string,
  ): Promise<CharacterJob | null> {
    const result = await this.pool.query<CharacterJobRow>(
      `UPDATE character_jobs AS job
       SET status = CASE WHEN job.attempt >= job.max_attempts THEN 'failed' ELSE 'queued' END,
           next_attempt_at = $4,
           lease_owner = NULL,
           lease_expires_at = NULL,
           error_code = $3,
           updated_at = $5,
           document = job.document || jsonb_build_object(
             'status', CASE WHEN job.attempt >= job.max_attempts THEN 'failed' ELSE 'queued' END,
             'nextAttemptAt', $4::text,
             'leaseOwner', NULL,
             'leaseExpiresAt', NULL,
             'errorCode', $3::text,
             'updatedAt', $5::text
           )
       WHERE job.id = $1 AND job.lease_owner = $2
       RETURNING ${characterJobReturning}`,
      [id, workerId, errorCode, nextAttemptAt, updatedAt],
    );
    return result.rows[0] ? mapCharacterJobRow(result.rows[0]) : null;
  }
}

function mapCharacterJobRow(row: CharacterJobRow): CharacterJob {
  return {
    ...row.document,
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    status: row.status,
    operationKey: row.operation_key,
    requestHash: row.request_hash,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    nextAttemptAt: toIso(row.next_attempt_at),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at ? toIso(row.lease_expires_at) : null,
    errorCode: row.error_code,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

const characterJobReturning = `
  job.id, job.project_id, job.type, job.status, job.operation_key,
  job.request_hash, job.document, job.attempt, job.max_attempts,
  job.next_attempt_at, job.lease_owner, job.lease_expires_at, job.error_code,
  job.created_at, job.updated_at
`;

const characterJobSelect = `
  SELECT id, project_id, type, status, operation_key, request_hash, document,
    attempt, max_attempts, next_attempt_at, lease_owner, lease_expires_at,
    error_code, created_at, updated_at
  FROM character_jobs
`;
