import type {
  CheckoutSession,
  PaymentProviderId,
  SubscriptionStatus,
  SubscriptionView,
} from "@motionprep/contracts";
import type { Pool } from "pg";
import type {
  BillingStatusSummary,
  BillingRepository,
  ProviderEventVersion,
} from "../../billing/billing-repository.js";
import { toIso } from "./database.js";

interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_id: SubscriptionView["planId"];
  status: SubscriptionStatus;
  renewal_at: Date | string;
  usage: SubscriptionView["usage"];
  provider: PaymentProviderId | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  cancel_at_period_end: boolean;
}

interface CheckoutRow {
  id: string;
  user_id: string;
  provider: PaymentProviderId;
  plan_id: SubscriptionView["planId"];
  status: CheckoutSession["status"];
  currency: CheckoutSession["currency"];
  amount_minor: number;
  checkout_url: string | null;
  provider_reference: string | null;
  created_at: Date | string;
  expires_at: Date | string;
}

export class PostgresBillingRepository implements BillingRepository {
  constructor(private readonly pool: Pool) {}

  async findSubscription(userId: string): Promise<SubscriptionView | null> {
    const result = await this.pool.query<SubscriptionRow>(
      `
        SELECT
          id, user_id, plan_id, status, renewal_at, usage, provider,
          provider_customer_id, provider_subscription_id,
          cancel_at_period_end
        FROM subscriptions
        WHERE user_id = $1
      `,
      [userId],
    );
    return result.rows[0] ? mapSubscription(result.rows[0]) : null;
  }

  async findSubscriptionByProviderReference(
    provider: SubscriptionView["provider"],
    providerSubscriptionId: string,
  ): Promise<SubscriptionView | null> {
    if (!provider) return null;
    const result = await this.pool.query<SubscriptionRow>(
      `
        SELECT
          id, user_id, plan_id, status, renewal_at, usage, provider,
          provider_customer_id, provider_subscription_id,
          cancel_at_period_end
        FROM subscriptions
        WHERE provider = $1 AND provider_subscription_id = $2
        LIMIT 1
      `,
      [provider, providerSubscriptionId],
    );
    return result.rows[0] ? mapSubscription(result.rows[0]) : null;
  }

  async listSubscriptions(limit: number): Promise<SubscriptionView[]> {
    const result = await this.pool.query<SubscriptionRow>(
      `SELECT
         id, user_id, plan_id, status, renewal_at, usage, provider,
         provider_customer_id, provider_subscription_id,
         cancel_at_period_end
       FROM subscriptions
       ORDER BY renewal_at DESC
       LIMIT $1`,
      [Math.max(1, Math.min(limit, 200))],
    );
    return result.rows.map(mapSubscription);
  }

  async saveSubscription(subscription: SubscriptionView): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO subscriptions (
          id, user_id, plan_id, status, renewal_at, usage, provider,
          provider_customer_id, provider_subscription_id,
          cancel_at_period_end
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (user_id) DO UPDATE SET
          plan_id = EXCLUDED.plan_id,
          status = EXCLUDED.status,
          renewal_at = EXCLUDED.renewal_at,
          usage = EXCLUDED.usage,
          provider = EXCLUDED.provider,
          provider_customer_id = EXCLUDED.provider_customer_id,
          provider_subscription_id = EXCLUDED.provider_subscription_id,
          cancel_at_period_end = EXCLUDED.cancel_at_period_end
      `,
      [
        subscription.id,
        subscription.userId,
        subscription.planId,
        subscription.status,
        subscription.renewalAt,
        JSON.stringify(subscription.usage),
        subscription.provider ?? null,
        subscription.providerCustomerId ?? null,
        subscription.providerSubscriptionId ?? null,
        subscription.cancelAtPeriodEnd ?? false,
      ],
    );
  }

  async saveSubscriptionFromProvider(
    subscription: SubscriptionView,
    event: ProviderEventVersion,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `
        INSERT INTO subscriptions (
          id, user_id, plan_id, status, renewal_at, usage, provider,
          provider_customer_id, provider_subscription_id,
          cancel_at_period_end, provider_event_created_at, provider_event_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (user_id) DO UPDATE SET
          plan_id = EXCLUDED.plan_id,
          status = EXCLUDED.status,
          renewal_at = EXCLUDED.renewal_at,
          usage = jsonb_build_object(
            'jobs', COALESCE(
              (subscriptions.usage ->> 'jobs')::integer,
              (EXCLUDED.usage ->> 'jobs')::integer
            ),
            'jobLimit', (EXCLUDED.usage ->> 'jobLimit')::integer,
            'processingMinutes', COALESCE(
              (subscriptions.usage ->> 'processingMinutes')::numeric,
              (EXCLUDED.usage ->> 'processingMinutes')::numeric
            ),
            'processingMinuteLimit',
              (EXCLUDED.usage ->> 'processingMinuteLimit')::numeric
          ),
          provider = EXCLUDED.provider,
          provider_customer_id = EXCLUDED.provider_customer_id,
          provider_subscription_id = EXCLUDED.provider_subscription_id,
          cancel_at_period_end = EXCLUDED.cancel_at_period_end,
          provider_event_created_at = EXCLUDED.provider_event_created_at,
          provider_event_id = EXCLUDED.provider_event_id
        WHERE
          subscriptions.provider_event_created_at IS NULL
          OR EXCLUDED.provider_event_created_at
            > subscriptions.provider_event_created_at
          OR (
            EXCLUDED.provider_event_created_at
              = subscriptions.provider_event_created_at
            AND EXCLUDED.provider_event_id COLLATE "C"
              > subscriptions.provider_event_id COLLATE "C"
          )
        RETURNING user_id
      `,
      [
        subscription.id,
        subscription.userId,
        subscription.planId,
        subscription.status,
        subscription.renewalAt,
        JSON.stringify(subscription.usage),
        subscription.provider ?? null,
        subscription.providerCustomerId ?? null,
        subscription.providerSubscriptionId ?? null,
        subscription.cancelAtPeriodEnd ?? false,
        event.occurredAt,
        event.eventId,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findCheckout(id: string): Promise<CheckoutSession | null> {
    const result = await this.pool.query<CheckoutRow>(
      `
        SELECT
          id, user_id, provider, plan_id, status, currency, amount_minor,
          checkout_url, provider_reference, created_at, expires_at
        FROM checkout_sessions
        WHERE id = $1
      `,
      [id],
    );
    return result.rows[0] ? mapCheckout(result.rows[0]) : null;
  }

  async listCheckouts(limit: number): Promise<CheckoutSession[]> {
    const result = await this.pool.query<CheckoutRow>(
      `SELECT
         id, user_id, provider, plan_id, status, currency, amount_minor,
         checkout_url, provider_reference, created_at, expires_at
       FROM checkout_sessions
       ORDER BY created_at DESC
       LIMIT $1`,
      [Math.max(1, Math.min(limit, 200))],
    );
    return result.rows.map(mapCheckout);
  }

  async summarizeStatuses(): Promise<BillingStatusSummary> {
    const [subscriptions, checkouts] = await Promise.all([
      this.pool.query<{ active: string | number }>(
        `SELECT count(*) FILTER (
           WHERE status IN ('active', 'trialing')
         ) AS active
         FROM subscriptions`,
      ),
      this.pool.query<{
        pending: string | number;
        paid: string | number;
      }>(`SELECT
           count(*) FILTER (
             WHERE status IN ('pending', 'redirect_required')
           ) AS pending,
           count(*) FILTER (WHERE status = 'paid') AS paid
         FROM checkout_sessions`),
    ]);
    return {
      activeSubscriptions: Number(subscriptions.rows[0]?.active ?? 0),
      pendingCheckouts: Number(checkouts.rows[0]?.pending ?? 0),
      paidCheckouts: Number(checkouts.rows[0]?.paid ?? 0),
    };
  }

  async ensurePendingCheckout(
    checkout: CheckoutSession,
  ): Promise<CheckoutSession> {
    await this.pool.query(
      `INSERT INTO checkout_sessions (
         id, user_id, provider, plan_id, status, currency, amount_minor,
         checkout_url, provider_reference, created_at, expires_at
       ) VALUES ($1, $2, $3, $4, 'pending', $5, $6, NULL, NULL, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        checkout.id,
        checkout.userId,
        checkout.provider,
        checkout.planId,
        checkout.currency,
        checkout.amountMinor,
        checkout.createdAt,
        checkout.expiresAt,
      ],
    );
    const current = await this.findCheckout(checkout.id);
    if (!current) throw new Error("Pending checkout was not persisted.");
    return current;
  }

  async completePendingCheckout(
    checkout: CheckoutSession,
  ): Promise<{ checkout: CheckoutSession; transitioned: boolean }> {
    const result = await this.pool.query<CheckoutRow>(
      `UPDATE checkout_sessions
       SET status = $2,
           checkout_url = $3,
           provider_reference = $4,
           expires_at = $5
       WHERE id = $1 AND status = 'pending'
       RETURNING
         id, user_id, provider, plan_id, status, currency, amount_minor,
         checkout_url, provider_reference, created_at, expires_at`,
      [
        checkout.id,
        checkout.status,
        checkout.checkoutUrl,
        checkout.providerReference ?? null,
        checkout.expiresAt,
      ],
    );
    if (result.rows[0]) {
      return { checkout: mapCheckout(result.rows[0]), transitioned: true };
    }
    const current = await this.findCheckout(checkout.id);
    if (!current) throw new Error("Pending checkout no longer exists.");
    return { checkout: current, transitioned: false };
  }

  async saveCheckout(checkout: CheckoutSession): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO checkout_sessions (
          id, user_id, provider, plan_id, status, currency, amount_minor,
          checkout_url, provider_reference, created_at, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          checkout_url = EXCLUDED.checkout_url,
          provider_reference = EXCLUDED.provider_reference,
          expires_at = EXCLUDED.expires_at
      `,
      [
        checkout.id,
        checkout.userId,
        checkout.provider,
        checkout.planId,
        checkout.status,
        checkout.currency,
        checkout.amountMinor,
        checkout.checkoutUrl,
        checkout.providerReference ?? null,
        checkout.createdAt,
        checkout.expiresAt,
      ],
    );
  }
}

function mapSubscription(row: SubscriptionRow): SubscriptionView {
  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    status: row.status,
    renewalAt: toIso(row.renewal_at),
    usage: row.usage,
    ...(row.provider ? { provider: row.provider } : {}),
    ...(row.provider_customer_id
      ? { providerCustomerId: row.provider_customer_id }
      : {}),
    ...(row.provider_subscription_id
      ? { providerSubscriptionId: row.provider_subscription_id }
      : {}),
    cancelAtPeriodEnd: row.cancel_at_period_end,
  };
}

function mapCheckout(row: CheckoutRow): CheckoutSession {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    planId: row.plan_id,
    status: row.status,
    currency: row.currency,
    amountMinor: row.amount_minor,
    checkoutUrl: row.checkout_url,
    ...(row.provider_reference
      ? { providerReference: row.provider_reference }
      : {}),
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
  };
}
