import type {
  CharacterBible,
  CharacterGenerationAttempt,
  CharacterGenerationReview,
  CharacterIdentityModelVersion,
  CharacterReferenceAsset,
  CharacterRigVersion,
} from "@motionprep/contracts";
import type { Pool } from "pg";
import type { CharacterRigRepository } from "../../character-rig/character-rig-repository.js";
import { rollbackTransaction } from "./database.js";

interface DocumentRow<T> {
  document: T;
}

export class PostgresCharacterRigRepository implements CharacterRigRepository {
  constructor(private readonly pool: Pool) {}

  async findBible(
    projectId: string,
    bibleId: string,
  ): Promise<CharacterBible | null> {
    return this.findDocument<CharacterBible>(
      "character_bibles",
      projectId,
      bibleId,
    );
  }

  async findLatestBible(projectId: string): Promise<CharacterBible | null> {
    const result = await this.pool.query<DocumentRow<CharacterBible>>(
      `SELECT document FROM character_bibles
       WHERE project_id = $1 ORDER BY version DESC LIMIT 1`,
      [projectId],
    );
    return result.rows[0]?.document ?? null;
  }

  async saveBibleIfRevision(
    bible: CharacterBible,
    expectedRevision: number | null,
  ): Promise<boolean> {
    if (
      (expectedRevision === null && bible.revision !== 1) ||
      (expectedRevision !== null && bible.revision !== expectedRevision + 1)
    ) {
      return false;
    }
    if (expectedRevision === null) {
      const inserted = await this.pool.query<{ id: string }>(
        `INSERT INTO character_bibles (
           id, project_id, version, revision, status, document,
           created_by_user_id, approved_by_user_id, approved_at, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        bibleValues(bible),
      );
      return inserted.rowCount === 1;
    }
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO character_bibles (
         id, project_id, version, revision, status, document,
         created_by_user_id, approved_by_user_id, approved_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         revision = EXCLUDED.revision,
         status = EXCLUDED.status,
         document = EXCLUDED.document,
         approved_by_user_id = EXCLUDED.approved_by_user_id,
         approved_at = EXCLUDED.approved_at,
         updated_at = EXCLUDED.updated_at
       WHERE $12::integer IS NOT NULL
         AND character_bibles.project_id = EXCLUDED.project_id
         AND character_bibles.version = EXCLUDED.version
         AND character_bibles.revision = $12
       RETURNING id`,
      [...bibleValues(bible), expectedRevision],
    );
    return result.rowCount === 1;
  }

  async addReference(reference: CharacterReferenceAsset): Promise<boolean> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO character_reference_assets (
         id, project_id, bible_id, role, canonical_view, rights_classification,
         artifact, document, retention_expires_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [
        reference.id,
        reference.projectId,
        reference.bibleId,
        reference.role,
        reference.canonicalView,
        reference.rightsClassification,
        JSON.stringify(reference.artifact),
        JSON.stringify(reference),
        reference.artifact.retentionExpiresAt,
        reference.createdAt,
      ],
    );
    return result.rowCount === 1;
  }

  async listReferences(
    projectId: string,
    bibleId: string,
  ): Promise<CharacterReferenceAsset[]> {
    const result = await this.pool.query<DocumentRow<CharacterReferenceAsset>>(
      `SELECT document FROM character_reference_assets
       WHERE project_id = $1 AND bible_id = $2 ORDER BY created_at`,
      [projectId, bibleId],
    );
    return result.rows.map((row) => row.document);
  }

  async findIdentityModelVersion(
    projectId: string,
    modelVersionId: string,
  ): Promise<CharacterIdentityModelVersion | null> {
    return this.findDocument<CharacterIdentityModelVersion>(
      "character_identity_model_versions",
      projectId,
      modelVersionId,
    );
  }

  async findLatestIdentityModelVersion(
    projectId: string,
    bibleId: string,
  ): Promise<CharacterIdentityModelVersion | null> {
    const result = await this.pool.query<
      DocumentRow<CharacterIdentityModelVersion>
    >(
      `SELECT document FROM character_identity_model_versions
       WHERE project_id = $1 AND bible_id = $2 ORDER BY version DESC LIMIT 1`,
      [projectId, bibleId],
    );
    return result.rows[0]?.document ?? null;
  }

  async saveIdentityModelVersion(
    model: CharacterIdentityModelVersion,
  ): Promise<boolean> {
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO character_identity_model_versions (
         id, project_id, bible_id, version, status, provider_key, document,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      modelValues(model),
    );
    if (inserted.rowCount === 1) return true;
    const updated = await this.pool.query<{ id: string }>(
      `UPDATE character_identity_model_versions SET
         status = $5,
         provider_key = $6,
         document = $7::jsonb,
         updated_at = $8
       WHERE id = $1 AND project_id = $2 AND bible_id = $3 AND version = $4
       RETURNING id`,
      [
        model.id, model.projectId, model.bibleId, model.version, model.status,
        model.providerKey, JSON.stringify(model), model.updatedAt,
      ],
    );
    return updated.rowCount === 1;
  }

  async findGenerationAttempt(
    projectId: string,
    generationAttemptId: string,
  ): Promise<CharacterGenerationAttempt | null> {
    return this.findDocument<CharacterGenerationAttempt>(
      "character_generation_attempts",
      projectId,
      generationAttemptId,
    );
  }

  async findGenerationByIdempotencyKey(
    projectId: string,
    idempotencyKey: string,
  ): Promise<CharacterGenerationAttempt | null> {
    const result = await this.pool.query<DocumentRow<CharacterGenerationAttempt>>(
      `SELECT document FROM character_generation_attempts
       WHERE project_id = $1 AND idempotency_key = $2`,
      [projectId, idempotencyKey],
    );
    return result.rows[0]?.document ?? null;
  }

  async listGenerationAttempts(
    projectId: string,
    bibleId: string,
  ): Promise<CharacterGenerationAttempt[]> {
    const result = await this.pool.query<
      DocumentRow<CharacterGenerationAttempt>
    >(
      `SELECT document FROM character_generation_attempts
       WHERE project_id = $1 AND bible_id = $2 ORDER BY created_at DESC`,
      [projectId, bibleId],
    );
    return result.rows.map((row) => row.document);
  }

  async saveGenerationAttempt(
    attempt: CharacterGenerationAttempt,
  ): Promise<boolean> {
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO character_generation_attempts (
         id, project_id, bible_id, identity_model_version_id, status,
         request_hash, idempotency_key, document, created_by_user_id,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      generationValues(attempt),
    );
    if (inserted.rowCount === 1) return true;
    const updated = await this.pool.query<{ id: string }>(
      `UPDATE character_generation_attempts SET
         status = $3,
         document = $6::jsonb,
         updated_at = $7
       WHERE id = $1 AND project_id = $2
         AND request_hash = $4 AND idempotency_key = $5
       RETURNING id`,
      [
        attempt.id, attempt.projectId, attempt.status, attempt.requestHash,
        attempt.idempotencyKey, JSON.stringify(attempt), attempt.updatedAt,
      ],
    );
    return updated.rowCount === 1;
  }

  async commitGenerationReview(
    review: CharacterGenerationReview,
    updatedAttempt: CharacterGenerationAttempt,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const attempt = await client.query<{ id: string }>(
        `SELECT id FROM character_generation_attempts
         WHERE id = $1 AND project_id = $2 AND status = 'needs-review'
         FOR UPDATE`,
        [review.generationAttemptId, review.projectId],
      );
      if (
        attempt.rowCount !== 1 ||
        updatedAttempt.id !== review.generationAttemptId ||
        updatedAttempt.projectId !== review.projectId
      ) {
        await client.query("ROLLBACK");
        return false;
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO character_generation_reviews (
           id, project_id, generation_attempt_id, decision, reason,
           reviewer_user_id, operation_id, document, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
         ON CONFLICT (reviewer_user_id, operation_id) DO NOTHING RETURNING id`,
        [
          review.id,
          review.projectId,
          review.generationAttemptId,
          review.decision,
          review.reason,
          review.reviewerUserId,
          review.operationId,
          JSON.stringify(review),
          review.createdAt,
        ],
      );
      if (inserted.rowCount !== 1) {
        await client.query("ROLLBACK");
        return false;
      }
      const updated = await client.query(
        `UPDATE character_generation_attempts
         SET status = $3, document = $4::jsonb, updated_at = $5
         WHERE id = $1 AND project_id = $2 AND status = 'needs-review'`,
        [
          updatedAttempt.id,
          updatedAttempt.projectId,
          updatedAttempt.status,
          JSON.stringify(updatedAttempt),
          updatedAttempt.updatedAt,
        ],
      );
      if (updated.rowCount !== 1) {
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

  async listGenerationReviews(
    projectId: string,
    generationAttemptId: string,
  ): Promise<CharacterGenerationReview[]> {
    const result = await this.pool.query<DocumentRow<CharacterGenerationReview>>(
      `SELECT document FROM character_generation_reviews
       WHERE project_id = $1 AND generation_attempt_id = $2 ORDER BY created_at`,
      [projectId, generationAttemptId],
    );
    return result.rows.map((row) => row.document);
  }

  async findRigVersion(
    projectId: string,
    rigVersionId: string,
  ): Promise<CharacterRigVersion | null> {
    return this.findDocument<CharacterRigVersion>(
      "character_rig_versions",
      projectId,
      rigVersionId,
    );
  }

  async findLatestRigVersion(
    projectId: string,
    bibleId: string,
  ): Promise<CharacterRigVersion | null> {
    const result = await this.pool.query<DocumentRow<CharacterRigVersion>>(
      `SELECT document FROM character_rig_versions
       WHERE project_id = $1 AND bible_id = $2 ORDER BY version DESC LIMIT 1`,
      [projectId, bibleId],
    );
    return result.rows[0]?.document ?? null;
  }

  async saveRigVersion(rig: CharacterRigVersion): Promise<boolean> {
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO character_rig_versions (
         id, project_id, bible_id, version, status, document,
         approved_by_user_id, approved_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      rigValues(rig),
    );
    if (inserted.rowCount === 1) return true;
    const updated = await this.pool.query<{ id: string }>(
      `UPDATE character_rig_versions SET
         status = $5,
         document = $6::jsonb,
         approved_by_user_id = $7,
         approved_at = $8,
         updated_at = $9
       WHERE id = $1 AND project_id = $2 AND bible_id = $3 AND version = $4
       RETURNING id`,
      [
        rig.id, rig.projectId, rig.bibleId, rig.version, rig.status,
        JSON.stringify(rig), rig.approvedByUserId, rig.approvedAt, rig.updatedAt,
      ],
    );
    return updated.rowCount === 1;
  }

  private async findDocument<T>(
    table: string,
    projectId: string,
    id: string,
  ): Promise<T | null> {
    const allowedTables = new Set([
      "character_bibles",
      "character_identity_model_versions",
      "character_generation_attempts",
      "character_rig_versions",
    ]);
    if (!allowedTables.has(table)) throw new Error("Unsupported character-rig table.");
    const result = await this.pool.query<DocumentRow<T>>(
      `SELECT document FROM ${table} WHERE project_id = $1 AND id = $2`,
      [projectId, id],
    );
    return result.rows[0]?.document ?? null;
  }
}

function bibleValues(bible: CharacterBible) {
  return [
    bible.id, bible.projectId, bible.version, bible.revision, bible.status,
    JSON.stringify(bible), bible.createdByUserId, bible.approvedByUserId,
    bible.approvedAt, bible.createdAt, bible.updatedAt,
  ];
}

function modelValues(model: CharacterIdentityModelVersion) {
  return [
    model.id, model.projectId, model.bibleId, model.version, model.status,
    model.providerKey, JSON.stringify(model), model.createdAt, model.updatedAt,
  ];
}

function generationValues(attempt: CharacterGenerationAttempt) {
  return [
    attempt.id, attempt.projectId, attempt.bibleId,
    attempt.identityModelVersionId, attempt.status, attempt.requestHash,
    attempt.idempotencyKey, JSON.stringify(attempt), attempt.createdByUserId,
    attempt.createdAt, attempt.updatedAt,
  ];
}

function rigValues(rig: CharacterRigVersion) {
  return [
    rig.id, rig.projectId, rig.bibleId, rig.version, rig.status,
    JSON.stringify(rig), rig.approvedByUserId, rig.approvedAt, rig.createdAt,
    rig.updatedAt,
  ];
}
