import type {
  CharacterGenerationAttempt,
  CharacterGenerationReview,
  CharacterRigReview,
  CharacterRigVersion,
} from "@motionprep/contracts";
import type { Pool } from "pg";
import { rollbackTransaction } from "./database.js";

export async function commitGenerationReview(
  pool: Pool,
  review: CharacterGenerationReview,
  updatedAttempt: CharacterGenerationAttempt,
): Promise<boolean> {
  const client = await pool.connect();
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

export async function commitRigReview(
  pool: Pool,
  review: CharacterRigReview,
  updatedRig: CharacterRigVersion,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rig = await client.query<{ id: string }>(
      `SELECT id FROM character_rig_versions
       WHERE id = $1 AND project_id = $2 AND status = 'needs-review'
       FOR UPDATE`,
      [review.rigVersionId, review.projectId],
    );
    if (
      rig.rowCount !== 1 ||
      updatedRig.id !== review.rigVersionId ||
      updatedRig.projectId !== review.projectId ||
      !["approved", "retired"].includes(updatedRig.status)
    ) {
      await client.query("ROLLBACK");
      return false;
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO character_rig_reviews (
         id, project_id, rig_version_id, decision, reason,
         reviewer_user_id, operation_id, document, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       ON CONFLICT (reviewer_user_id, operation_id) DO NOTHING RETURNING id`,
      [
        review.id,
        review.projectId,
        review.rigVersionId,
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
      `UPDATE character_rig_versions SET
         status = $3,
         document = $4::jsonb,
         approved_by_user_id = $5,
         approved_at = $6,
         updated_at = $7
       WHERE id = $1 AND project_id = $2 AND status = 'needs-review'`,
      [
        updatedRig.id,
        updatedRig.projectId,
        updatedRig.status,
        JSON.stringify(updatedRig),
        updatedRig.approvedByUserId,
        updatedRig.approvedAt,
        updatedRig.updatedAt,
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
