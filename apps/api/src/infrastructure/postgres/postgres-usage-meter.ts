import type { SubscriptionView } from "@motionprep/contracts";
import type { Pool, PoolClient } from "pg";
import {
  assertCanReserve,
  starterSubscription,
  type UsageMeter,
  type UsageMeterMode,
} from "../../billing/usage-meter.js";

interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_id: SubscriptionView["planId"];
  status: SubscriptionView["status"];
  renewal_at: Date | string;
  usage: SubscriptionView["usage"];
}

export class PostgresUsageMeter implements UsageMeter {
  constructor(
    private readonly pool: Pool,
    private readonly mode: UsageMeterMode,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reserveJob(userId: string, jobId: string): Promise<void> {
    if (this.mode === "off") return;
    await this.transaction(async (client) => {
      const fallback = starterSubscription(userId, this.now());
      await client.query(
        `INSERT INTO subscriptions (
           id, user_id, plan_id, status, renewal_at, usage,
           cancel_at_period_end
         )
         VALUES ($1, $2, 'starter', 'active', $3, $4::jsonb, false)
         ON CONFLICT (user_id) DO NOTHING`,
        [
          fallback.id,
          userId,
          fallback.renewalAt,
          JSON.stringify(fallback.usage),
        ],
      );
      let subscription = await this.lockSubscription(client, userId);
      if (Date.parse(subscription.renewalAt) <= this.now().getTime()) {
        subscription = {
          ...subscription,
          renewalAt: new Date(
            this.now().getTime() + 30 * 24 * 60 * 60_000,
          ).toISOString(),
          usage: {
            ...subscription.usage,
            jobs: 0,
            processingMinutes: 0,
          },
        };
        await this.saveUsage(client, subscription);
      }
      const existing = await client.query(
        `SELECT 1 FROM usage_ledger
         WHERE job_id = $1 AND event_key = 'reserve'`,
        [jobId],
      );
      if (existing.rowCount) return;

      assertCanReserve(subscription, this.mode);
      const next = {
        ...subscription,
        usage: {
          ...subscription.usage,
          jobs: subscription.usage.jobs + 1,
        },
      };
      await client.query(
        `INSERT INTO usage_ledger (
           id, subscription_id, user_id, job_id, event_key, jobs_delta,
           processing_seconds, period_end
         )
         VALUES ($1, $2, $3, $4, 'reserve', 1, 0, $5)`,
        [
          crypto.randomUUID(),
          subscription.id,
          userId,
          jobId,
          subscription.renewalAt,
        ],
      );
      await this.saveUsage(client, next);
    });
  }

  async releaseJob(jobId: string): Promise<void> {
    if (this.mode === "off") return;
    await this.transaction(async (client) => {
      const reservation = await client.query<{
        user_id: string;
        subscription_id: string;
        period_end: Date | string;
      }>(
        `SELECT user_id, subscription_id, period_end
         FROM usage_ledger
         WHERE job_id = $1 AND event_key = 'reserve'`,
        [jobId],
      );
      const row = reservation.rows[0];
      if (!row) return;
      const inserted = await client.query(
        `INSERT INTO usage_ledger (
           id, subscription_id, user_id, job_id, event_key, jobs_delta,
           processing_seconds, period_end
         )
         VALUES ($1, $2, $3, $4, 'release', -1, 0, $5)
         ON CONFLICT (job_id, event_key) DO NOTHING
         RETURNING id`,
        [
          crypto.randomUUID(),
          row.subscription_id,
          row.user_id,
          jobId,
          row.period_end,
        ],
      );
      if (!inserted.rowCount) return;
      const subscription = await this.lockSubscription(client, row.user_id);
      await this.saveUsage(client, {
        ...subscription,
        usage: {
          ...subscription.usage,
          jobs: Math.max(0, subscription.usage.jobs - 1),
        },
      });
    });
  }

  async recordProcessingSeconds(
    jobId: string,
    attempt: number,
    seconds: number,
  ): Promise<void> {
    if (this.mode === "off") return;
    await this.transaction(async (client) => {
      const reservation = await client.query<{
        user_id: string;
        subscription_id: string;
        period_end: Date | string;
      }>(
        `SELECT user_id, subscription_id, period_end
         FROM usage_ledger
         WHERE job_id = $1 AND event_key = 'reserve'`,
        [jobId],
      );
      const row = reservation.rows[0];
      if (!row) return;
      const safeSeconds = Math.max(0, Math.ceil(seconds));
      const inserted = await client.query(
        `INSERT INTO usage_ledger (
           id, subscription_id, user_id, job_id, event_key, jobs_delta,
           processing_seconds, period_end
         )
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7)
         ON CONFLICT (job_id, event_key) DO NOTHING
         RETURNING id`,
        [
          crypto.randomUUID(),
          row.subscription_id,
          row.user_id,
          jobId,
          `processing:${attempt}`,
          safeSeconds,
          row.period_end,
        ],
      );
      if (!inserted.rowCount) return;
      const subscription = await this.lockSubscription(client, row.user_id);
      await this.saveUsage(client, {
        ...subscription,
        usage: {
          ...subscription.usage,
          processingMinutes: roundUsage(
            subscription.usage.processingMinutes + safeSeconds / 60,
          ),
        },
      });
    });
  }

  private async lockSubscription(
    client: PoolClient,
    userId: string,
  ): Promise<SubscriptionView> {
    const result = await client.query<SubscriptionRow>(
      `SELECT id, user_id, plan_id, status, renewal_at, usage
       FROM subscriptions
       WHERE user_id = $1
       FOR UPDATE`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Subscription reservation could not be created.");
    return {
      id: row.id,
      userId: row.user_id,
      planId: row.plan_id,
      status: row.status,
      renewalAt:
        row.renewal_at instanceof Date
          ? row.renewal_at.toISOString()
          : row.renewal_at,
      usage: row.usage,
    };
  }

  private async saveUsage(
    client: PoolClient,
    subscription: SubscriptionView,
  ): Promise<void> {
    await client.query(
      `UPDATE subscriptions
       SET usage = $2::jsonb, renewal_at = $3
       WHERE id = $1`,
      [
        subscription.id,
        JSON.stringify(subscription.usage),
        subscription.renewalAt,
      ],
    );
  }

  private async transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function roundUsage(value: number): number {
  return Math.round(value * 100) / 100;
}
