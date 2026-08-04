import type {
  CheckoutSession,
  UserSummary,
} from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryAuditRepository } from "../audit/audit-repository.js";
import { AuditService } from "../audit/audit-service.js";
import { InMemoryBillingRepository } from "./billing-repository.js";
import { BillingService } from "./billing-service.js";
import type {
  CreateProviderCheckoutInput,
  PaymentProvider,
} from "./payment-provider.js";

describe("billing checkout recovery", () => {
  it("resumes a pending provider operation with the same external identity", async () => {
    const repository = new FailFirstCheckoutCompletionRepository();
    const provider = new RecordingProvider();
    const auditRepository = new InMemoryAuditRepository();
    const service = new BillingService(
      repository,
      [provider],
      new AuditService(auditRepository),
      () => new Date("2026-08-03T18:00:00.000Z"),
    );
    const input = {
      actor,
      providerId: "sandbox-local" as const,
      planId: "creator" as const,
      currency: "EGP" as const,
      returnUrl: "https://motionprep.example/billing/return",
      idempotencyKey: "checkout-recovery-001",
      requestId: "request-checkout-001",
    };

    await expect(service.createCheckout(input)).rejects.toThrow(
      "simulated checkout persistence outage",
    );
    const recovered = await service.createCheckout({
      ...input,
      requestId: "request-checkout-002",
    });

    expect(recovered).toMatchObject({
      status: "redirect_required",
      checkoutUrl: expect.stringContaining(recovered.id),
    });
    expect(provider.checkoutIds).toEqual([recovered.id, recovered.id]);
    expect(await auditRepository.list(10)).toHaveLength(1);
  });

  it("completes a pending checkout only once under concurrent callbacks", async () => {
    const repository = new InMemoryBillingRepository();
    const pending = checkout("pending");
    await repository.ensurePendingCheckout(pending);
    const ready = {
      ...pending,
      status: "redirect_required" as const,
      checkoutUrl: "https://payments.example/session",
      providerReference: "provider-session-1",
    };

    const results = await Promise.all([
      repository.completePendingCheckout(ready),
      repository.completePendingCheckout(ready),
    ]);

    expect(results.filter((result) => result.transitioned)).toHaveLength(1);
    expect(results.every((result) => result.checkout.status === "redirect_required"))
      .toBe(true);
  });
});

class FailFirstCheckoutCompletionRepository extends InMemoryBillingRepository {
  #shouldFail = true;

  override async completePendingCheckout(checkout: CheckoutSession) {
    if (this.#shouldFail) {
      this.#shouldFail = false;
      throw new Error("simulated checkout persistence outage");
    }
    return super.completePendingCheckout(checkout);
  }
}

class RecordingProvider implements PaymentProvider {
  readonly id = "sandbox-local" as const;
  readonly checkoutIds: string[] = [];

  async createCheckout(input: CreateProviderCheckoutInput) {
    this.checkoutIds.push(input.checkoutId);
    return {
      checkoutUrl: `https://payments.example/${input.checkoutId}`,
      externalReference: `provider-${input.checkoutId}`,
    };
  }
}

const actor: UserSummary = {
  id: "62a31a7f-9a78-4b7c-991c-77dc64922c97",
  name: "Checkout Recovery",
  email: "checkout-recovery@example.test",
  role: "creator",
  status: "active",
  mfaEnabled: false,
  createdAt: "2026-08-03T17:00:00.000Z",
  lastLoginAt: null,
};

function checkout(status: CheckoutSession["status"]): CheckoutSession {
  return {
    id: "9dc3b9dd-a9c5-4c7a-9be2-3785e7c60bc7",
    userId: actor.id,
    provider: "sandbox-local",
    planId: "creator",
    status,
    currency: "EGP",
    amountMinor: 59000,
    checkoutUrl: null,
    createdAt: "2026-08-03T18:00:00.000Z",
    expiresAt: "2026-08-03T18:30:00.000Z",
  };
}
