import { request } from "./transport";
import type { BillingConfiguration, SubscriptionSummary } from "./models";

export function getSubscription(): Promise<SubscriptionSummary> {
  return request("/v1/billing/subscription");
}

export function getBillingConfiguration(): Promise<BillingConfiguration> {
  return request("/v1/billing/config");
}

export function createHostedCheckout(input: {
  providerId: "sandbox-card" | "sandbox-local" | "stripe";
  planId: "creator" | "studio";
  currency: "USD" | "EGP";
  returnUrl: string;
}): Promise<{ checkoutUrl: string | null }> {
  return request("/v1/billing/checkouts", {
    method: "POST",
    headers: { "x-idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(input),
  });
}

export function completeSandboxCheckout(
  checkoutId: string,
): Promise<{ status: string }> {
  return request(`/v1/billing/checkouts/${checkoutId}/complete-sandbox`, {
    method: "POST",
  });
}

export function createBillingPortal(
  returnUrl: string,
): Promise<{ portalUrl: string }> {
  return request("/v1/billing/portal", {
    method: "POST",
    body: JSON.stringify({ returnUrl }),
  });
}
