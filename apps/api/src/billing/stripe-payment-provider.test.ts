import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { StripePaymentProvider } from "./stripe-payment-provider.js";

describe("StripePaymentProvider", () => {
  it("creates a hosted subscription checkout without collecting card data", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "cs_test_motionprep",
      url: "https://checkout.stripe.com/c/pay/cs_test_motionprep",
    });
    const stripe = {
      checkout: { sessions: { create } },
      webhooks: {},
    } as unknown as Stripe;
    const provider = new StripePaymentProvider(
      {
        secretKey: "sk_test_motionprep",
        webhookSecret: "whsec_motionprep",
      },
      stripe,
    );

    const result = await provider.createCheckout({
      checkoutId: "89a8e97e-a0a9-4a69-8d54-cb46ba9a36d0",
      userId: "18d6b7cc-3c0f-4542-bdc3-c52481909c68",
      customerEmail: "creator@example.com",
      planId: "creator",
      currency: "USD",
      amountMinor: 1900,
      returnUrl: "https://studio.example.com/billing/return",
      expiresAt: "2026-07-28T12:30:00.000Z",
    });

    expect(result.checkoutUrl).toContain("checkout.stripe.com");
    expect(create).toHaveBeenCalledOnce();
    const [parameters, requestOptions] = create.mock.calls[0]!;
    expect(parameters.mode).toBe("subscription");
    expect(parameters.customer_email).toBe("creator@example.com");
    expect(parameters.line_items[0].price_data.unit_amount).toBe(1900);
    expect(parameters.metadata.motionprep_checkout_id).toBe(
      "89a8e97e-a0a9-4a69-8d54-cb46ba9a36d0",
    );
    expect(requestOptions.idempotencyKey).toBe(
      "89a8e97e-a0a9-4a69-8d54-cb46ba9a36d0",
    );
  });

  it("verifies a signed raw webhook and rejects an invalid signature", () => {
    const stripe = new Stripe("sk_test_motionprep");
    const webhookSecret = "whsec_motionprep_test_secret";
    const provider = new StripePaymentProvider(
      { secretKey: "sk_test_motionprep", webhookSecret },
      stripe,
    );
    const payload = JSON.stringify({
      id: "evt_motionprep_paid",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_motionprep",
          object: "checkout.session",
          client_reference_id: "89a8e97e-a0a9-4a69-8d54-cb46ba9a36d0",
          metadata: {},
          amount_total: 1900,
          currency: "usd",
          payment_status: "paid",
        },
      },
    });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
      timestamp: Math.floor(Date.now() / 1000),
    });

    const event = provider.verifyWebhook!(Buffer.from(payload), {
      "stripe-signature": signature,
    });
    expect(event).toMatchObject({
      eventId: "evt_motionprep_paid",
      status: "paid",
      amountMinor: 1900,
      currency: "USD",
    });
    expect(() =>
      provider.verifyWebhook!(Buffer.from(payload), {
        "stripe-signature": "t=1,v1=invalid",
      }),
    ).toThrow();
  });

  it("maps subscription lifecycle events and creates a hosted portal", async () => {
    const stripeForSignature = new Stripe("sk_test_motionprep");
    const webhookSecret = "whsec_motionprep_test_secret";
    const portalCreate = vi.fn().mockResolvedValue({
      url: "https://billing.stripe.com/p/session/test",
    });
    const stripe = {
      billingPortal: { sessions: { create: portalCreate } },
      webhooks: stripeForSignature.webhooks,
    } as unknown as Stripe;
    const provider = new StripePaymentProvider(
      { secretKey: "sk_test_motionprep", webhookSecret },
      stripe,
    );
    const payload = JSON.stringify({
      id: "evt_subscription_past_due",
      object: "event",
      created: 1_785_200_000,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_motionprep",
          object: "subscription",
          customer: "cus_motionprep",
          status: "past_due",
          cancel_at_period_end: false,
          metadata: {
            motionprep_checkout_id:
              "89a8e97e-a0a9-4a69-8d54-cb46ba9a36d0",
            motionprep_user_id:
              "18d6b7cc-3c0f-4542-bdc3-c52481909c68",
            motionprep_plan_id: "creator",
          },
          items: {
            data: [{ current_period_end: 1_787_875_200 }],
          },
        },
      },
    });
    const signature =
      stripeForSignature.webhooks.generateTestHeaderString({
        payload,
        secret: webhookSecret,
        timestamp: Math.floor(Date.now() / 1000),
      });

    expect(
      provider.verifyWebhook!(Buffer.from(payload), {
        "stripe-signature": signature,
      }),
    ).toMatchObject({
      kind: "subscription",
      status: "past_due",
      providerCustomerId: "cus_motionprep",
      providerSubscriptionId: "sub_motionprep",
      planId: "creator",
      cancelAtPeriodEnd: false,
    });

    const portal = await provider.createCustomerPortal(
      "cus_motionprep",
      "https://studio.example.com/billing",
    );
    expect(portal.portalUrl).toContain("billing.stripe.com");
    expect(portalCreate).toHaveBeenCalledWith({
      customer: "cus_motionprep",
      return_url: "https://studio.example.com/billing",
    });
  });
});
