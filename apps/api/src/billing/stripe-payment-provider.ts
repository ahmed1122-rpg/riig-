import Stripe from "stripe";
import type {
  CreateProviderCheckoutInput,
  PaymentProvider,
  ProviderWebhookEvent,
} from "./payment-provider.js";

export interface StripePaymentProviderOptions {
  secretKey: string;
  webhookSecret: string;
}

export class StripePaymentProvider implements PaymentProvider {
  readonly id = "stripe" as const;
  readonly #stripe: Stripe;

  constructor(
    private readonly options: StripePaymentProviderOptions,
    stripe?: Stripe,
  ) {
    this.#stripe =
      stripe ??
      new Stripe(options.secretKey, {
        maxNetworkRetries: 2,
        timeout: 10_000,
      });
  }

  async createCheckout(input: CreateProviderCheckoutInput): Promise<{
    checkoutUrl: string;
    externalReference: string;
  }> {
    const separator = input.returnUrl.includes("?") ? "&" : "?";
    const session = await this.#stripe.checkout.sessions.create(
      {
        mode: "subscription",
        client_reference_id: input.checkoutId,
        customer_email: input.customerEmail,
        success_url:
          `${input.returnUrl}${separator}` +
          "payment=success&session_id={CHECKOUT_SESSION_ID}",
        cancel_url: `${input.returnUrl}${separator}payment=cancelled`,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amountMinor,
              recurring: { interval: "month" },
              product_data: {
                name: `MotionPrep ${input.planId}`,
                metadata: { motionprep_plan_id: input.planId },
              },
            },
          },
        ],
        metadata: {
          motionprep_checkout_id: input.checkoutId,
          motionprep_user_id: input.userId,
          motionprep_plan_id: input.planId,
        },
        subscription_data: {
          metadata: {
            motionprep_checkout_id: input.checkoutId,
            motionprep_user_id: input.userId,
            motionprep_plan_id: input.planId,
          },
        },
      },
      { idempotencyKey: input.checkoutId },
    );
    if (!session.url) {
      throw new Error("Stripe did not return a hosted Checkout URL.");
    }
    return {
      checkoutUrl: session.url,
      externalReference: session.id,
    };
  }

  async createCustomerPortal(
    customerId: string,
    returnUrl: string,
  ): Promise<{ portalUrl: string }> {
    const session = await this.#stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return { portalUrl: session.url };
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | string[] | undefined>>,
  ): ProviderWebhookEvent | null {
    const signatureHeader = headers["stripe-signature"];
    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0]
      : signatureHeader;
    if (!signature) throw new Error("Missing Stripe-Signature header.");

    const event = this.#stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.options.webhookSecret,
      300,
    );
    if (
      [
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
      ].includes(event.type)
    ) {
      const subscription = event.data.object as Stripe.Subscription;
      const providerCustomerId = referenceId(subscription.customer);
      if (!providerCustomerId) {
        throw new Error("Stripe subscription has no customer reference.");
      }
      const renewalTimestamp = Math.max(
        ...subscription.items.data.map((item) => item.current_period_end),
        event.created + 30 * 24 * 60 * 60,
      );
      return {
        kind: "subscription",
        eventId: event.id,
        checkoutId:
          subscription.metadata.motionprep_checkout_id ?? null,
        userId: subscription.metadata.motionprep_user_id ?? null,
        planId: planId(subscription.metadata.motionprep_plan_id),
        status:
          event.type === "customer.subscription.deleted"
            ? "cancelled"
            : subscriptionStatus(subscription.status),
        providerCustomerId,
        providerSubscriptionId: subscription.id,
        renewalAt: new Date(renewalTimestamp * 1_000).toISOString(),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        externalReference: subscription.id,
      };
    }

    if (
      ![
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "checkout.session.async_payment_failed",
        "checkout.session.expired",
      ].includes(event.type)
    ) {
      return null;
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const checkoutId =
      session.client_reference_id ??
      session.metadata?.motionprep_checkout_id;
    if (!checkoutId) throw new Error("Stripe event has no checkout reference.");

    if (
      event.type === "checkout.session.completed" &&
      session.payment_status !== "paid" &&
      session.payment_status !== "no_payment_required"
    ) {
      return null;
    }
    const status =
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
        ? "paid"
        : event.type === "checkout.session.expired"
          ? "cancelled"
          : "failed";
    return {
      kind: "checkout",
      eventId: event.id,
      checkoutId,
      status,
      amountMinor: session.amount_total,
      currency:
        session.currency?.toUpperCase() === "USD" ||
        session.currency?.toUpperCase() === "EGP"
          ? (session.currency.toUpperCase() as "USD" | "EGP")
          : null,
      externalReference: session.id,
      providerCustomerId: referenceId(session.customer),
      providerSubscriptionId: referenceId(session.subscription),
      renewalAt: null,
    };
  }
}

function referenceId(
  reference:
    | string
    | { id: string }
    | null
    | undefined,
): string | null {
  return typeof reference === "string" ? reference : reference?.id ?? null;
}

function planId(
  value: string | undefined,
): "starter" | "creator" | "studio" | null {
  return value === "starter" || value === "creator" || value === "studio"
    ? value
    : null;
}

function subscriptionStatus(
  value: Stripe.Subscription.Status,
): "trialing" | "active" | "past_due" | "cancelled" {
  if (value === "trialing") return "trialing";
  if (value === "active") return "active";
  if (value === "canceled") return "cancelled";
  return "past_due";
}
