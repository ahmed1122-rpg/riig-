import type { FastifyInstance } from "fastify";
import { afterEach, expect } from "vitest";
import { buildApp } from "./app.js";
import type {
  CreateProviderCheckoutInput,
  PaymentProvider,
} from "./billing/payment-provider.js";

class AppTestHarness {
  #app: FastifyInstance | undefined;

  async build(...args: Parameters<typeof buildApp>) {
    this.#app = await buildApp(...args);
    return this.#app;
  }

  async close(): Promise<void> {
    await this.#app?.close();
    this.#app = undefined;
  }
}

export function createAppTestHarness(): AppTestHarness {
  const harness = new AppTestHarness();
  afterEach(() => harness.close());
  return harness;
}

export function sessionCookie(
  header: string | string[] | undefined,
): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value?.split(";")[0] ?? "";
}

export async function registerCreator(
  app: FastifyInstance,
  email = "owner@example.com",
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      name: "مالك المشروع",
      email,
      password: "StrongPass123",
    },
  });
  expect(response.statusCode).toBe(201);
  return sessionCookie(response.headers["set-cookie"]);
}

export class FakeStripeProvider implements PaymentProvider {
  readonly id = "stripe" as const;
  checkoutId: string | null = null;
  receivedRawBody = false;

  async createCheckout(input: CreateProviderCheckoutInput) {
    this.checkoutId = input.checkoutId;
    return {
      checkoutUrl: `https://checkout.example.test/${input.checkoutId}`,
      externalReference: `stripe_${input.checkoutId}`,
    };
  }

  async createCustomerPortal(customerId: string, returnUrl: string) {
    return {
      portalUrl:
        `https://billing.example.test/portal/${customerId}` +
        `?return=${encodeURIComponent(returnUrl)}`,
    };
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Readonly<
      Record<string, string | string[] | undefined>
    >,
  ) {
    if (headers["x-test-signature"] !== "valid") {
      throw new Error("invalid signature");
    }
    this.receivedRawBody = Buffer.isBuffer(rawBody);
    const body = JSON.parse(rawBody.toString("utf8")) as {
      eventId: string;
      kind?: "subscription";
      status?: "active" | "past_due" | "cancelled";
    };
    if (body.kind === "subscription") {
      return {
        kind: "subscription" as const,
        eventId: body.eventId,
        checkoutId: this.checkoutId,
        userId: null,
        planId: "creator" as const,
        status: body.status ?? ("active" as const),
        providerCustomerId: "cus_motionprep",
        providerSubscriptionId: "sub_motionprep",
        renewalAt: "2026-09-28T00:00:00.000Z",
        cancelAtPeriodEnd: body.status === "cancelled",
        externalReference: "sub_motionprep",
      };
    }
    return {
      kind: "checkout" as const,
      eventId: body.eventId,
      checkoutId: this.checkoutId!,
      status: "paid" as const,
      amountMinor: 1900,
      currency: "USD" as const,
      externalReference: "cs_test_motionprep",
      providerCustomerId: "cus_motionprep",
      providerSubscriptionId: "sub_motionprep",
      renewalAt: "2026-08-28T00:00:00.000Z",
    };
  }
}
