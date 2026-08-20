import type { Pool, PoolClient } from "pg";
import type {
  EmailVerificationMessage,
  PasswordResetMessage,
} from "../../auth/email-sender.js";
import type {
  AuthRepository,
  EmailVerificationRecord,
  MfaChallengeRecord,
  MfaEnrollmentRecord,
  MfaLoginCommit,
  MfaLoginCommitResult,
  PasswordResetRecord,
  SessionRecord,
  UserSecurityChanges,
  UserRecord,
} from "../../auth/auth-repository.js";
import { commitPostgresMfaLogin } from "./postgres-auth-mfa-command.js";
import {
  mapMfaEnrollment,
  mapSession,
  mapToken,
  mapUser,
  type MfaEnrollmentRow,
  type SessionRow,
  type TokenRow,
  type UserRow,
  userSelect,
} from "./postgres-auth-rows.js";
import {
  consumePostgresEmailVerification,
  replacePostgresEmailVerification,
  saveFirstPostgresAdmin,
  savePendingPostgresRegistration,
} from "./postgres-auth-registration.js";

export interface PostgresAuthRepositoryHooks {
  afterPasswordResetStored?(client: PoolClient): Promise<void>;
}

export class PostgresAuthRepository implements AuthRepository {
  constructor(
    private readonly pool: Pool | PoolClient,
    private readonly hooks: PostgresAuthRepositoryHooks = {},
  ) {}

  async findUserById(id: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRow>(
      `${userSelect} WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRow>(
      `${userSelect} WHERE email = $1`,
      [email.trim().toLowerCase()],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async listUsers(): Promise<UserRecord[]> {
    const result = await this.pool.query<UserRow>(
      `${userSelect} ORDER BY created_at DESC`,
    );
    return result.rows.map(mapUser);
  }

  async saveUser(user: UserRecord): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO users (
          id, name, email, role, status, password_hash, created_at,
          last_login_at, mfa_enabled, mfa_secret_ciphertext,
          recovery_code_hashes, terms_version, privacy_version, legal_accepted_at,
          deletion_requested_at, deleted_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          role = EXCLUDED.role,
          status = EXCLUDED.status,
          password_hash = EXCLUDED.password_hash,
          last_login_at = EXCLUDED.last_login_at,
          mfa_enabled = EXCLUDED.mfa_enabled,
          mfa_secret_ciphertext = EXCLUDED.mfa_secret_ciphertext,
          recovery_code_hashes = EXCLUDED.recovery_code_hashes,
          terms_version = EXCLUDED.terms_version,
          privacy_version = EXCLUDED.privacy_version,
          legal_accepted_at = EXCLUDED.legal_accepted_at,
          deletion_requested_at = EXCLUDED.deletion_requested_at,
          deleted_at = EXCLUDED.deleted_at
      `,
      [
        user.id,
        user.name,
        user.email,
        user.role,
        user.status,
        user.passwordHash,
        user.createdAt,
        user.lastLoginAt,
        user.mfaEnabled,
        user.mfaSecretCiphertext,
        user.recoveryCodeHashes,
        user.termsVersion ?? null,
        user.privacyVersion ?? null,
        user.legalAcceptedAt ?? null,
        user.deletionRequestedAt ?? null,
        user.deletedAt ?? null,
      ],
    );
  }

  savePendingRegistration(
    user: UserRecord,
    verification: EmailVerificationRecord,
    delivery?: EmailVerificationMessage,
  ): Promise<"queued" | "stored" | "email_exists"> {
    return savePendingPostgresRegistration(this.pool, user, verification, delivery);
  }

  consumeEmailVerification(
    tokenHash: string,
    now: string,
  ): Promise<UserRecord | null> {
    return consumePostgresEmailVerification(this.pool, tokenHash, now);
  }

  replaceEmailVerification(
    userId: string,
    verification: EmailVerificationRecord,
    delivery?: EmailVerificationMessage,
  ): Promise<"queued" | "stored" | "not_pending"> {
    return replacePostgresEmailVerification(
      this.pool,
      userId,
      verification,
      delivery,
    );
  }

  async deleteEmailVerificationsByUser(userId: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM email_verification_tokens WHERE user_id = $1",
      [userId],
    );
  }

  saveFirstAdmin(user: UserRecord): Promise<boolean> {
    return saveFirstPostgresAdmin(this.pool, user);
  }

  async updateUser(
    id: string,
    changes: Partial<Pick<UserRecord, "role" | "status" | "lastLoginAt">>,
  ): Promise<UserRecord | null> {
    const updateLastLogin = Object.hasOwn(changes, "lastLoginAt");
    const result = await this.pool.query<UserRow>(
      `
        UPDATE users
        SET
          role = COALESCE($2, role),
          status = COALESCE($3, status),
          last_login_at = CASE
            WHEN $4::boolean THEN $5::timestamptz
            ELSE last_login_at
          END
        WHERE id = $1
        RETURNING
          id, name, email, role, status, password_hash, mfa_enabled,
          mfa_secret_ciphertext, recovery_code_hashes, created_at,
          last_login_at, terms_version, privacy_version, legal_accepted_at,
          deletion_requested_at, deleted_at
      `,
      [
        id,
        changes.role ?? null,
        changes.status ?? null,
        updateLastLogin,
        changes.lastLoginAt ?? null,
      ],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async updateSecurity(
    id: string,
    changes: UserSecurityChanges,
  ): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRow>(
      `
        UPDATE users
        SET
          password_hash = CASE WHEN $2::boolean THEN $3 ELSE password_hash END,
          mfa_enabled = CASE WHEN $4::boolean THEN $5 ELSE mfa_enabled END,
          mfa_secret_ciphertext = CASE
            WHEN $6::boolean THEN $7
            ELSE mfa_secret_ciphertext
          END,
          recovery_code_hashes = CASE
            WHEN $8::boolean THEN $9::text[]
            ELSE recovery_code_hashes
          END
        WHERE id = $1
        RETURNING
          id, name, email, role, status, password_hash, mfa_enabled,
          mfa_secret_ciphertext, recovery_code_hashes, created_at,
          last_login_at, terms_version, privacy_version, legal_accepted_at,
          deletion_requested_at, deleted_at
      `,
      [
        id,
        Object.hasOwn(changes, "passwordHash"),
        changes.passwordHash ?? null,
        Object.hasOwn(changes, "mfaEnabled"),
        changes.mfaEnabled ?? null,
        Object.hasOwn(changes, "mfaSecretCiphertext"),
        changes.mfaSecretCiphertext ?? null,
        Object.hasOwn(changes, "recoveryCodeHashes"),
        changes.recoveryCodeHashes ?? null,
      ],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async findSession(tokenHash: string): Promise<SessionRecord | null> {
    const result = await this.pool.query<SessionRow>(
      `
        SELECT token_hash, user_id, created_at, expires_at
        FROM sessions
        WHERE token_hash = $1
      `,
      [tokenHash],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async saveSession(session: SessionRecord): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO sessions (
          token_hash, user_id, created_at, expires_at
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (token_hash) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          created_at = EXCLUDED.created_at,
          expires_at = EXCLUDED.expires_at
      `,
      [
        session.tokenHash,
        session.userId,
        session.createdAt,
        session.expiresAt,
      ],
    );
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [
      tokenHash,
    ]);
  }

  async deleteSessionsByUser(userId: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
  }

  async saveMfaEnrollment(record: MfaEnrollmentRecord): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO mfa_enrollments (
          token_hash, user_id, secret_ciphertext, expires_at
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (token_hash) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          secret_ciphertext = EXCLUDED.secret_ciphertext,
          expires_at = EXCLUDED.expires_at
      `,
      [
        record.tokenHash,
        record.userId,
        record.secretCiphertext,
        record.expiresAt,
      ],
    );
  }

  async consumeMfaEnrollment(
    tokenHash: string,
    userId: string,
    now: string,
  ): Promise<MfaEnrollmentRecord | null> {
    const result = await this.pool.query<MfaEnrollmentRow>(
      `
        DELETE FROM mfa_enrollments
        WHERE token_hash = $1 AND user_id = $2 AND expires_at > $3
        RETURNING token_hash, user_id, secret_ciphertext, expires_at
      `,
      [tokenHash, userId, now],
    );
    return result.rows[0] ? mapMfaEnrollment(result.rows[0]) : null;
  }

  async saveMfaChallenge(record: MfaChallengeRecord): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO mfa_challenges (token_hash, user_id, expires_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (token_hash) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          expires_at = EXCLUDED.expires_at
      `,
      [record.tokenHash, record.userId, record.expiresAt],
    );
  }

  async findMfaChallenge(
    tokenHash: string,
    now: string,
  ): Promise<MfaChallengeRecord | null> {
    const result = await this.pool.query<TokenRow>(
      `
        SELECT token_hash, user_id, expires_at
        FROM mfa_challenges
        WHERE token_hash = $1 AND expires_at > $2
      `,
      [tokenHash, now],
    );
    return result.rows[0] ? mapToken(result.rows[0]) : null;
  }

  async commitMfaLogin(
    input: MfaLoginCommit,
  ): Promise<MfaLoginCommitResult> {
    return commitPostgresMfaLogin(this.pool, input);
  }

  async consumeRecoveryCode(
    userId: string,
    codeHash: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE users
        SET recovery_code_hashes = array_remove(recovery_code_hashes, $2)
        WHERE id = $1
          AND mfa_enabled = TRUE
          AND status = 'active'
          AND deletion_requested_at IS NULL
          AND deleted_at IS NULL
          AND $2 = ANY(recovery_code_hashes)
        RETURNING id
      `,
      [userId, codeHash],
    );
    return result.rowCount === 1;
  }

  async deleteMfaChallenge(tokenHash: string): Promise<void> {
    await this.pool.query("DELETE FROM mfa_challenges WHERE token_hash = $1", [
      tokenHash,
    ]);
  }

  async deleteMfaChallengesByUser(userId: string): Promise<void> {
    await this.pool.query("DELETE FROM mfa_challenges WHERE user_id = $1", [
      userId,
    ]);
  }

  async savePasswordReset(
    record: PasswordResetRecord,
    delivery?: PasswordResetMessage,
  ): Promise<"queued" | "stored"> {
    const ownsClient = "connect" in this.pool;
    const client = ownsClient ? await this.pool.connect() : this.pool;
    try {
      if (ownsClient) await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO password_reset_tokens (token_hash, user_id, expires_at)
          VALUES ($1, $2, $3)
          ON CONFLICT (token_hash) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            expires_at = EXCLUDED.expires_at
        `,
        [record.tokenHash, record.userId, record.expiresAt],
      );
      await this.hooks.afterPasswordResetStored?.(client as PoolClient);
      if (delivery) {
        await client.query(
          `
            INSERT INTO email_outbox (
              id, kind, recipient, action_url, expires_at, status,
              next_attempt_at, created_at, updated_at
            )
            VALUES ($1, 'password-reset', $2, $3, $4, 'queued', now(), now(), now())
          `,
          [
            crypto.randomUUID(),
            delivery.recipient,
            delivery.resetUrl,
            delivery.expiresAt,
          ],
        );
      }
      if (ownsClient) await client.query("COMMIT");
      return delivery ? "queued" : "stored";
    } catch (error) {
      if (ownsClient) await client.query("ROLLBACK");
      throw error;
    } finally {
      if (ownsClient) (client as PoolClient).release();
    }
  }

  async consumePasswordReset(
    tokenHash: string,
    now: string,
  ): Promise<PasswordResetRecord | null> {
    const result = await this.pool.query<TokenRow>(
      `
        DELETE FROM password_reset_tokens
        WHERE token_hash = $1 AND expires_at > $2
        RETURNING token_hash, user_id, expires_at
      `,
      [tokenHash, now],
    );
    return result.rows[0] ? mapToken(result.rows[0]) : null;
  }

  async deletePasswordResetsByUser(userId: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM password_reset_tokens WHERE user_id = $1",
      [userId],
    );
  }
}
