import type { FastifyInstance } from "fastify";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@motionprep/contracts";
import { afterEach, expect } from "vitest";
import { buildApp } from "./app.js";
import type {
  CreateProviderCheckoutInput,
  PaymentProvider,
} from "./billing/payment-provider.js";

export const TEST_PASSWORD = ["Strong", "Pass", "123"].join("");

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

export const legalAcceptance = {
  accepted: true,
  termsVersion: CURRENT_TERMS_VERSION,
  privacyVersion: CURRENT_PRIVACY_VERSION,
} as const;

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
      password: TEST_PASSWORD,
      legal: legalAcceptance,
    },
  });
  expect(response.statusCode).toBe(201);
  return sessionCookie(response.headers["set-cookie"]);
}

export async function approveCurrentReview(
  app: FastifyInstance,
  cookie: string,
  projectId: string,
  sourceVersionId: string,
): Promise<number> {
  const document = await app.inject({
    method: "GET",
    url:
      `/v1/projects/${projectId}/layer-document` +
      `?sourceVersionId=${sourceVersionId}`,
    headers: { cookie },
  });
  expect(document.statusCode).toBe(200);
  const revision = document.json().data.revision as number;
  const approved = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/review/approve`,
    headers: {
      cookie,
      "x-idempotency-key": `approve-${projectId}-${revision}`,
    },
    payload: { sourceVersionId, documentRevision: revision },
  });
  expect(approved.statusCode).toBe(200);
  expect(approved.json().data.status).toBe("approved");
  return revision;
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
      occurredAt?: number;
      kind?: "subscription";
      status?: "active" | "past_due" | "cancelled";
    };
    if (body.kind === "subscription") {
      return {
        kind: "subscription" as const,
        eventId: body.eventId,
        occurredAt: body.occurredAt ?? 1_785_200_100,
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
      occurredAt: body.occurredAt ?? 1_785_200_000,
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
