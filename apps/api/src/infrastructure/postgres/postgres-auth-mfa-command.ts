import type { Pool, PoolClient } from "pg";
import type {
  MfaLoginCommit,
  MfaLoginCommitResult,
} from "../../auth/auth-repository.js";

interface LockedUserRow {
  recovery_code_hashes: string[];
}

interface ChallengeRow {
  token_hash: string;
}

export async function commitPostgresMfaLogin(
  pool: Pool | PoolClient,
  input: MfaLoginCommit,
): Promise<MfaLoginCommitResult> {
  if (input.session.userId !== input.userId) {
    throw new Error("MFA session owner must match the challenge owner.");
  }

  const ownsClient = !("release" in pool);
  const client: PoolClient = ownsClient
    ? await (pool as Pool).connect()
    : (pool as PoolClient);
  try {
    if (ownsClient) await client.query("BEGIN");
    const user = await client.query<LockedUserRow>(
      `
        SELECT recovery_code_hashes
        FROM users
        WHERE id = $1
          AND status = 'active'
          AND mfa_enabled = TRUE
          AND deletion_requested_at IS NULL
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [input.userId],
    );
    if (!user.rows[0]) {
      await rollbackOwnedTransaction(client, ownsClient);
      return "user_invalid";
    }

    const lockedChallenge = await client.query<ChallengeRow>(
      `
        SELECT token_hash
        FROM mfa_challenges
        WHERE token_hash = $1 AND user_id = $2 AND expires_at > $3
        FOR UPDATE
      `,
      [input.tokenHash, input.userId, input.now],
    );
    if (!lockedChallenge.rows[0]) {
      await rollbackOwnedTransaction(client, ownsClient);
      return "challenge_invalid";
    }
    if (
      input.recoveryCodeHash &&
      !user.rows[0].recovery_code_hashes.includes(input.recoveryCodeHash)
    ) {
      await rollbackOwnedTransaction(client, ownsClient);
      return "recovery_invalid";
    }
    const challenge = await client.query<ChallengeRow>(
      `
        DELETE FROM mfa_challenges
        WHERE token_hash = $1 AND user_id = $2 AND expires_at > $3
        RETURNING token_hash
      `,
      [input.tokenHash, input.userId, input.now],
    );
    if (!challenge.rows[0]) {
      await rollbackOwnedTransaction(client, ownsClient);
      return "challenge_invalid";
    }

    await client.query(
      `
        UPDATE users
        SET
          last_login_at = $2,
          recovery_code_hashes = CASE
            WHEN $3::text IS NULL THEN recovery_code_hashes
            ELSE array_remove(recovery_code_hashes, $3::text)
          END
        WHERE id = $1
      `,
      [input.userId, input.lastLoginAt, input.recoveryCodeHash ?? null],
    );
    await client.query(
      `
        INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
        VALUES ($1, $2, $3, $4)
      `,
      [
        input.session.tokenHash,
        input.session.userId,
        input.session.createdAt,
        input.session.expiresAt,
      ],
    );
    await client.query("DELETE FROM mfa_challenges WHERE user_id = $1", [
      input.userId,
    ]);
    if (ownsClient) await client.query("COMMIT");
    return "committed";
  } catch (error) {
    if (ownsClient) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownsClient) client.release();
  }
}

async function rollbackOwnedTransaction(
  client: PoolClient,
  ownsClient: boolean,
): Promise<void> {
  if (ownsClient) await client.query("ROLLBACK");
}
