import type {
  CharacterBible,
  CharacterReferenceAsset,
  CharacterRigReview,
  CharacterRigVersion,
} from "@motionprep/contracts";
import type { Pool } from "pg";
import type { CharacterRigRepository } from "../../character-rig/character-rig-repository.js";
import { commitRigReview } from "./postgres-character-review-command.js";

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

  async findRigReviewByOperation(
    reviewerUserId: string,
    operationId: string,
  ): Promise<CharacterRigReview | null> {
    const result = await this.pool.query<DocumentRow<CharacterRigReview>>(
      `SELECT document FROM character_rig_reviews
       WHERE reviewer_user_id = $1 AND operation_id = $2`,
      [reviewerUserId, operationId],
    );
    return result.rows[0]?.document ?? null;
  }

  async commitRigReview(
    review: CharacterRigReview,
    updatedRig: CharacterRigVersion,
  ): Promise<boolean> {
    return commitRigReview(this.pool, review, updatedRig);
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
        rig.id,
        rig.projectId,
        rig.bibleId,
        rig.version,
        rig.status,
        JSON.stringify(rig),
        rig.approvedByUserId,
        rig.approvedAt,
        rig.updatedAt,
      ],
    );
    return updated.rowCount === 1;
  }

  private async findDocument<T>(
    table: "character_bibles" | "character_rig_versions",
    projectId: string,
    id: string,
  ): Promise<T | null> {
    const result = await this.pool.query<DocumentRow<T>>(
      `SELECT document FROM ${table} WHERE project_id = $1 AND id = $2`,
      [projectId, id],
    );
    return result.rows[0]?.document ?? null;
  }
}

function bibleValues(bible: CharacterBible) {
  return [
    bible.id,
    bible.projectId,
    bible.version,
    bible.revision,
    bible.status,
    JSON.stringify(bible),
    bible.createdByUserId,
    bible.approvedByUserId,
    bible.approvedAt,
    bible.createdAt,
    bible.updatedAt,
  ];
}

function rigValues(rig: CharacterRigVersion) {
  return [
    rig.id,
    rig.projectId,
    rig.bibleId,
    rig.version,
    rig.status,
    JSON.stringify(rig),
    rig.approvedByUserId,
    rig.approvedAt,
    rig.createdAt,
    rig.updatedAt,
  ];
}
