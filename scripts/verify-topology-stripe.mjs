import { Pool } from "pg";
import Stripe from "stripe";

export async function verifyStripeWebhookIdempotency({
  targetUserId,
  databaseUrl,
  webhookSecret,
  api,
}) {
  const checkoutId = crypto.randomUUID();
  const providerSuffix = crypto.randomUUID().replaceAll("-", "");
  const checkoutReference = `cs_topology_${providerSuffix}`;
  const customerReference = `cus_topology_${providerSuffix}`;
  const subscriptionReference = `sub_topology_${providerSuffix}`;
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      `INSERT INTO checkout_sessions (
         id, user_id, provider, plan_id, status, currency, amount_minor,
         checkout_url, provider_reference, created_at, expires_at
       )
       VALUES ($1, $2, 'stripe', 'creator', 'redirect_required', 'USD',
         1900, 'https://checkout.stripe.test/session', $3,
         now(), now() + interval '30 minutes')`,
      [checkoutId, targetUserId, checkoutReference],
    );
  } finally {
    await pool.end();
  }
  const payload = JSON.stringify({
    id: `evt_${crypto.randomUUID().replaceAll("-", "")}`,
    object: "event",
    api_version: "2025-06-30.basil",
    created: Math.floor(Date.now() / 1_000),
    type: "checkout.session.completed",
    data: {
      object: {
        id: checkoutReference,
        object: "checkout.session",
        client_reference_id: checkoutId,
        payment_status: "paid",
        amount_total: 1900,
        currency: "usd",
        customer: customerReference,
        subscription: subscriptionReference,
        metadata: {
          motionprep_checkout_id: checkoutId,
          motionprep_user_id: targetUserId,
          motionprep_plan_id: "creator",
        },
      },
    },
  });
  const signature = new Stripe("test_stripe_key_motionprep_topology_only")
    .webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  const webhookOptions = {
    method: "POST",
    body: payload,
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
    expectedStatus: 200,
  };
  const first = await api(0, "/v1/billing/webhooks/stripe", webhookOptions);
  const duplicate = await api(1, "/v1/billing/webhooks/stripe", webhookOptions);
  if (!first.body.data.processed || !duplicate.body.data.duplicate) {
    throw new Error("Signed Stripe webhook was not idempotent across replicas.");
  }
  const verificationPool = new Pool({ connectionString: databaseUrl });
  try {
    const verification = await verificationPool.query(
      `SELECT
         checkout.status AS checkout_status,
         subscription.plan_id AS plan_id,
         (SELECT count(*)::integer FROM audit_events
          WHERE target_type = 'checkout' AND target_id = checkout.id::text
            AND action = 'billing.webhook.paid') AS paid_audit_count
       FROM checkout_sessions AS checkout
       JOIN subscriptions AS subscription ON subscription.user_id = checkout.user_id
       WHERE checkout.id = $1`,
      [checkoutId],
    );
    const row = verification.rows[0];
    if (
      row?.checkout_status !== "paid" ||
      row?.plan_id !== "creator" ||
      Number(row?.paid_audit_count) !== 1
    ) {
      throw new Error("Stripe webhook replay changed billing state more than once.");
    }
  } finally {
    await verificationPool.end();
  }
}
