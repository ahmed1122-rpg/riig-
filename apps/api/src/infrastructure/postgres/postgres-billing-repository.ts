import type {
  CheckoutSession,
  PaymentProviderId,
  SubscriptionStatus,
  SubscriptionView,
} from "@motionprep/contracts";
import type { Pool } from "pg";
import type { BillingRepository } from "../../billing/billing-repository.js";
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
