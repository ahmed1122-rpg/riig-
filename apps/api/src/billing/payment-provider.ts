import type {
  CheckoutSession,
  PaymentProviderId,
  SubscriptionView,
} from "@motionprep/contracts";

export interface CreateProviderCheckoutInput {
  checkoutId: string;
  userId: string;
  customerEmail: string;
  planId: SubscriptionView["planId"];
  currency: CheckoutSession["currency"];
  amountMinor: number;
  returnUrl: string;
  expiresAt: string;
}

interface ProviderCheckoutWebhookEvent {
  kind: "checkout";
  eventId: string;
  checkoutId: string;
  status: "paid" | "failed" | "cancelled";
  amountMinor: number | null;
  currency: CheckoutSession["currency"] | null;
  externalReference: string;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  renewalAt: string | null;
}

interface ProviderSubscriptionWebhookEvent {
  kind: "subscription";
  eventId: string;
  checkoutId: string | null;
  userId: string | null;
  planId: SubscriptionView["planId"] | null;
  status: SubscriptionView["status"];
  providerCustomerId: string;
  providerSubscriptionId: string;
  renewalAt: string;
  cancelAtPeriodEnd: boolean;
  externalReference: string;
}

export type ProviderWebhookEvent =
  | ProviderCheckoutWebhookEvent
  | ProviderSubscriptionWebhookEvent;

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  createCheckout(
    input: CreateProviderCheckoutInput,
  ): Promise<{ checkoutUrl: string; externalReference: string }>;
  verifyWebhook?(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | string[] | undefined>>,
  ): ProviderWebhookEvent | null;
  createCustomerPortal?(
    customerId: string,
    returnUrl: string,
  ): Promise<{ portalUrl: string }>;
}

export class SandboxPaymentProvider implements PaymentProvider {
  constructor(readonly id: PaymentProviderId) {}

  async createCheckout(
    input: CreateProviderCheckoutInput,
  ): Promise<{ checkoutUrl: string; externalReference: string }> {
    const separator = input.returnUrl.includes("?") ? "&" : "?";
    return {
      checkoutUrl:
        `${input.returnUrl}${separator}sandbox_checkout=${input.checkoutId}` +
        `&provider=${this.id}`,
      externalReference: `sandbox_${this.id}_${input.checkoutId}`,
    };
  }
}
