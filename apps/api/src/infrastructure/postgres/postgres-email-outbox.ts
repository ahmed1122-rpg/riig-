import type { PasswordResetMessage } from "../../auth/email-sender.js";
import type { Pool } from "pg";

export interface ClaimedEmailDelivery {
  id: string;
  message: PasswordResetMessage;
  attempt: number;
  maxAttempts: number;
}

export interface EmailOutboxRepository {
  claimNext(
    workerId: string,
    claimedAt: string,
    leaseExpiresAt: string,
  ): Promise<ClaimedEmailDelivery | null>;
  markSent(id: string, workerId: string, sentAt: string): Promise<boolean>;
  retryOrFail(
    id: string,
    workerId: string,
    errorCode: string,
    nextAttemptAt: string,
    failedAt: string,
  ): Promise<"queued" | "failed" | null>;
}

interface EmailOutboxRow {
  id: string;
  recipient: string;
  reset_url: string;
  expires_at: Date | string;
  attempt: number;
  max_attempts: number;
}

export class PostgresEmailOutboxRepository implements EmailOutboxRepository {
  constructor(private readonly pool: Pool) {}

  async claimNext(
    workerId: string,
    claimedAt: string,
    leaseExpiresAt: string,
  ): Promise<ClaimedEmailDelivery | null> {
    await this.pool.query(
      `
        UPDATE email_outbox
        SET status = 'failed', error_code = 'DELIVERY_EXPIRED',
            recipient = '', reset_url = '', lease_owner = NULL,
            lease_expires_at = NULL, updated_at = $1
        WHERE status IN ('queued', 'sending') AND expires_at <= $1
      `,
      [claimedAt],
    );
    const result = await this.pool.query<EmailOutboxRow>(
      `
        WITH candidate AS (
          SELECT id
          FROM email_outbox
          WHERE attempt < max_attempts
            AND expires_at > $2
            AND (
              (status = 'queued' AND next_attempt_at <= $2) OR
              (status = 'sending' AND lease_expires_at <= $2)
            )
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE email_outbox AS delivery
        SET status = 'sending', attempt = delivery.attempt + 1,
            lease_owner = $1, lease_expires_at = $3,
            error_code = NULL, updated_at = $2
        FROM candidate
        WHERE delivery.id = candidate.id
        RETURNING delivery.id, delivery.recipient, delivery.reset_url,
          delivery.expires_at, delivery.attempt, delivery.max_attempts
      `,
      [workerId, claimedAt, leaseExpiresAt],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          attempt: row.attempt,
          maxAttempts: row.max_attempts,
          message: {
            recipient: row.recipient,
            resetUrl: row.reset_url,
            expiresAt:
              row.expires_at instanceof Date
                ? row.expires_at.toISOString()
                : row.expires_at,
          },
        }
      : null;
  }

  async markSent(
    id: string,
    workerId: string,
    sentAt: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE email_outbox
        SET status = 'sent', recipient = '', reset_url = '',
            delivered_at = $3, lease_owner = NULL, lease_expires_at = NULL,
            error_code = NULL, updated_at = $3
        WHERE id = $1 AND lease_owner = $2 AND status = 'sending'
      `,
      [id, workerId, sentAt],
    );
    return result.rowCount === 1;
  }

  async retryOrFail(
    id: string,
    workerId: string,
    errorCode: string,
    nextAttemptAt: string,
    failedAt: string,
  ): Promise<"queued" | "failed" | null> {
    const result = await this.pool.query<{ status: "queued" | "failed" }>(
      `
        UPDATE email_outbox
        SET status = CASE
              WHEN attempt >= max_attempts OR expires_at <= $5
                THEN 'failed' ELSE 'queued' END,
            recipient = CASE
              WHEN attempt >= max_attempts OR expires_at <= $5
                THEN '' ELSE recipient END,
            reset_url = CASE
              WHEN attempt >= max_attempts OR expires_at <= $5
                THEN '' ELSE reset_url END,
            next_attempt_at = $4, lease_owner = NULL,
            lease_expires_at = NULL, error_code = $3, updated_at = $5
        WHERE id = $1 AND lease_owner = $2 AND status = 'sending'
        RETURNING status
      `,
      [id, workerId, errorCode, nextAttemptAt, failedAt],
    );
    return result.rows[0]?.status ?? null;
  }
}
