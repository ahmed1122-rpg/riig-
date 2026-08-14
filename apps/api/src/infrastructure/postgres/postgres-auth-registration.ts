import type { Pool, PoolClient } from "pg";
import type { EmailVerificationMessage } from "../../auth/email-sender.js";
import type {
  EmailVerificationRecord,
  UserRecord,
} from "../../auth/auth-repository.js";
import { rollbackTransaction } from "./database.js";

export async function savePendingPostgresRegistration(
  pool: Pool | PoolClient,
  user: UserRecord,
  verification: EmailVerificationRecord,
  delivery?: EmailVerificationMessage,
): Promise<"queued" | "stored" | "email_exists"> {
  return withOptionalTransaction(pool, async (client) => {
    const inserted = await client.query(
      `INSERT INTO users (
         id, name, email, role, status, password_hash, created_at,
         last_login_at, mfa_enabled, mfa_secret_ciphertext,
         recovery_code_hashes, terms_version, privacy_version, legal_accepted_at,
         deletion_requested_at, deleted_at
       )
       VALUES ($1, $2, $3, $4, 'pending_verification', $5, $6, NULL,
         FALSE, NULL, '{}', $7, $8, $9, NULL, NULL)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [
        user.id,
        user.name,
        user.email,
        user.role,
        user.passwordHash,
        user.createdAt,
        user.termsVersion ?? null,
        user.privacyVersion ?? null,
        user.legalAcceptedAt ?? null,
      ],
    );
    if (inserted.rowCount !== 1) return "email_exists";
    await client.query(
      `INSERT INTO email_verification_tokens (token_hash, user_id, expires_at)
       VALUES ($1, $2, $3)`,
      [verification.tokenHash, verification.userId, verification.expiresAt],
    );
    if (!delivery) return "stored";
    await enqueueVerificationDelivery(client, delivery);
    return "queued";
  });
}

export async function consumePostgresEmailVerification(
  pool: Pool | PoolClient,
  tokenHash: string,
  now: string,
): Promise<UserRecord | null> {
  return withOptionalTransaction(pool, async (client) => {
    const token = await client.query<{ user_id: string }>(
      `DELETE FROM email_verification_tokens
       WHERE token_hash = $1 AND expires_at > $2
       RETURNING user_id`,
      [tokenHash, now],
    );
    const userId = token.rows[0]?.user_id;
    if (!userId) return null;
    const result = await client.query(
      `UPDATE users
       SET status = 'active', last_login_at = $2
       WHERE id = $1 AND status = 'pending_verification'
         AND deletion_requested_at IS NULL AND deleted_at IS NULL
       RETURNING *`,
      [userId, now],
    );
    return result.rows[0] ? mapRegistrationUser(result.rows[0]) : null;
  });
}

export async function replacePostgresEmailVerification(
  pool: Pool | PoolClient,
  userId: string,
  verification: EmailVerificationRecord,
  delivery?: EmailVerificationMessage,
): Promise<"queued" | "stored" | "not_pending"> {
  return withOptionalTransaction(pool, async (client) => {
    const pending = await client.query(
      `SELECT id FROM users
       WHERE id = $1 AND status = 'pending_verification'
         AND deletion_requested_at IS NULL AND deleted_at IS NULL
       FOR UPDATE`,
      [userId],
    );
    if (pending.rowCount !== 1) return "not_pending";
    await client.query(
      "DELETE FROM email_verification_tokens WHERE user_id = $1",
      [userId],
    );
    await client.query(
      `INSERT INTO email_verification_tokens (token_hash, user_id, expires_at)
       VALUES ($1, $2, $3)`,
      [verification.tokenHash, userId, verification.expiresAt],
    );
    if (!delivery) return "stored";
    await enqueueVerificationDelivery(client, delivery);
    return "queued";
  });
}

export async function saveFirstPostgresAdmin(
  pool: Pool | PoolClient,
  user: UserRecord,
): Promise<boolean> {
  return withOptionalTransaction(pool, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('motionprep_admin_bootstrap'))",
    );
    const inserted = await client.query(
      `INSERT INTO users (
         id, name, email, role, status, password_hash, created_at,
         last_login_at, mfa_enabled, mfa_secret_ciphertext,
         recovery_code_hashes, terms_version, privacy_version, legal_accepted_at,
         deletion_requested_at, deleted_at
       )
       SELECT $1, $2, $3, 'admin', 'active', $4, $5, $5,
         FALSE, NULL, '{}', $6, $7, $8, NULL, NULL
       WHERE NOT EXISTS (
         SELECT 1 FROM users WHERE role = 'admin' AND deleted_at IS NULL
       )
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [
        user.id,
        user.name,
        user.email,
        user.passwordHash,
        user.createdAt,
        user.termsVersion ?? null,
        user.privacyVersion ?? null,
        user.legalAcceptedAt ?? null,
      ],
    );
    return inserted.rowCount === 1;
  });
}

async function withOptionalTransaction<Result>(
  pool: Pool | PoolClient,
  command: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  const ownsClient = "connect" in pool;
  const client = ownsClient ? await pool.connect() : pool;
  try {
    if (ownsClient) await client.query("BEGIN");
    const result = await command(client as PoolClient);
    if (ownsClient) await client.query("COMMIT");
    return result;
  } catch (error) {
    if (ownsClient) await rollbackTransaction(client as PoolClient, error);
    throw error;
  } finally {
    if (ownsClient) (client as PoolClient).release();
  }
}

async function enqueueVerificationDelivery(
  client: PoolClient,
  delivery: EmailVerificationMessage,
): Promise<void> {
  await client.query(
    `INSERT INTO email_outbox (
       id, kind, recipient, action_url, expires_at, status,
       next_attempt_at, created_at, updated_at
     )
     VALUES ($1, 'email-verification', $2, $3, $4, 'queued', now(), now(), now())`,
    [
      crypto.randomUUID(),
      delivery.recipient,
      delivery.verificationUrl,
      delivery.expiresAt,
    ],
  );
}

function mapRegistrationUser(row: Record<string, unknown>): UserRecord {
  const date = (value: unknown) =>
    value instanceof Date ? value.toISOString() : String(value);
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: row.role as UserRecord["role"],
    status: row.status as UserRecord["status"],
    passwordHash: String(row.password_hash),
    mfaEnabled: Boolean(row.mfa_enabled),
    mfaSecretCiphertext: row.mfa_secret_ciphertext as string | null,
    recoveryCodeHashes: row.recovery_code_hashes as string[],
    createdAt: date(row.created_at),
    lastLoginAt: row.last_login_at ? date(row.last_login_at) : null,
    termsVersion: row.terms_version as string | null,
    privacyVersion: row.privacy_version as string | null,
    legalAcceptedAt: row.legal_accepted_at ? date(row.legal_accepted_at) : null,
    deletionRequestedAt: row.deletion_requested_at
      ? date(row.deletion_requested_at)
      : null,
    deletedAt: row.deleted_at ? date(row.deleted_at) : null,
  };
}
