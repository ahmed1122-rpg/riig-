import type {
  CheckoutSession,
  PaymentProviderId,
  SubscriptionView,
  UserSummary,
} from "@motionprep/contracts";
import { BILLING_PLAN_CATALOG } from "@motionprep/contracts";
import type { AuditService } from "../audit/audit-service.js";
import {
  InMemoryIdempotencyStore,
  type IdempotencyStore,
} from "../idempotency/idempotency-store.js";
import type { BillingRepository } from "./billing-repository.js";
import type { PaymentProvider } from "./payment-provider.js";
import { starterSubscription } from "./usage-meter.js";

export class BillingDomainError extends Error {
  constructor(
    readonly code:
      | "PAYMENT_PROVIDER_UNAVAILABLE"
      | "CHECKOUT_NOT_FOUND"
      | "CHECKOUT_NOT_COMPLETABLE"
      | "CHECKOUT_REQUEST_IN_PROGRESS"
      | "WEBHOOK_SIGNATURE_INVALID"
      | "WEBHOOK_EVENT_INVALID"
      | "SUBSCRIPTION_NOT_MANAGEABLE",
    message: string,
  ) {
    super(message);
  }
}

export class BillingService {
  readonly #providers: Map<PaymentProviderId, PaymentProvider>;

  constructor(
    private readonly repository: BillingRepository,
    providers: PaymentProvider[],
    private readonly audit: AuditService,
    private readonly now: () => Date = () => new Date(),
    private readonly idempotency: IdempotencyStore =
      new InMemoryIdempotencyStore(),
  ) {
    this.#providers = new Map(providers.map((provider) => [provider.id, provider]));
  }

  availableProviders(): PaymentProviderId[] {
    return [...this.#providers.keys()];
  }

  planCatalog() {
    return BILLING_PLAN_CATALOG;
  }

  async subscription(userId: string): Promise<SubscriptionView> {
    const existing = await this.repository.findSubscription(userId);
    if (existing) return existing;
    const now = this.now();
    const subscription = starterSubscription(userId, now);
    await this.repository.saveSubscription(subscription);
    return subscription;
  }

  async createCheckout(input: {
    actor: UserSummary;
    providerId: PaymentProviderId;
    planId: SubscriptionView["planId"];
    currency: CheckoutSession["currency"];
    returnUrl: string;
    idempotencyKey: string;
    requestId: string;
  }): Promise<CheckoutSession> {
    const scopedIdempotencyKey =
      `${input.actor.id}:${input.idempotencyKey}`;
    const provider = this.#providers.get(input.providerId);
    if (!provider) {
      throw new BillingDomainError(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "مزود الدفع غير متاح في هذه البيئة.",
      );
    }

    const now = this.now();
    const id = crypto.randomUUID();
    const claimedId = await this.idempotency.claim(
      "billing-checkout",
      scopedIdempotencyKey,
      id,
      24 * 60 * 60,
    );
    if (claimedId !== id) {
      const existing = await this.repository.findCheckout(claimedId);
      if (existing) return existing;
      throw new BillingDomainError(
        "CHECKOUT_REQUEST_IN_PROGRESS",
        "طلب الدفع المطابق ما زال قيد الإنشاء. أعد المحاولة بعد لحظات.",
      );
    }

    const expiresAt = new Date(now.getTime() + 30 * 60_000).toISOString();
    const amountMinor = planFor(input.planId).prices[input.currency];
    let checkout: CheckoutSession;
    let providerReference: string;
    try {
      const providerResult = await provider.createCheckout({
        checkoutId: id,
        userId: input.actor.id,
        customerEmail: input.actor.email,
        planId: input.planId,
        currency: input.currency,
        amountMinor,
        returnUrl: input.returnUrl,
        expiresAt,
      });
      providerReference = providerResult.externalReference;
      checkout = {
        id,
        userId: input.actor.id,
        provider: input.providerId,
        planId: input.planId,
        status: "redirect_required",
        currency: input.currency,
        amountMinor,
        checkoutUrl: providerResult.checkoutUrl,
        providerReference,
        createdAt: now.toISOString(),
        expiresAt,
      };
      await this.repository.saveCheckout(checkout);
    } catch (error) {
      await this.idempotency.release(
        "billing-checkout",
        scopedIdempotencyKey,
        id,
      );
      throw error;
    }
    await this.audit.record({
      actorUserId: input.actor.id,
      action: "billing.checkout.created",
      targetType: "checkout",
      targetId: checkout.id,
      outcome: "success",
      reason: `provider=${providerReference}`,
      requestId: input.requestId,
    });
    return checkout;
  }

  async completeSandbox(
    checkoutId: string,
    actor: UserSummary,
    requestId: string,
  ): Promise<CheckoutSession> {
    const checkout = await this.repository.findCheckout(checkoutId);
    if (!checkout || checkout.userId !== actor.id) {
      throw new BillingDomainError(
        "CHECKOUT_NOT_FOUND",
        "جلسة الدفع غير موجودة.",
      );
    }
    if (checkout.status === "paid") return checkout;
    if (checkout.status !== "redirect_required") {
      throw new BillingDomainError(
        "CHECKOUT_NOT_COMPLETABLE",
        "لا يمكن إكمال جلسة الدفع في حالتها الحالية.",
      );
    }

    const paid = { ...checkout, status: "paid" as const };
    await this.repository.saveCheckout(paid);
    await this.activateSubscription(actor.id, checkout.planId);
    await this.audit.record({
      actorUserId: actor.id,
      action: "billing.checkout.paid_sandbox",
      targetType: "checkout",
      targetId: checkout.id,
      outcome: "success",
      reason: "sandbox-only completion",
      requestId,
    });
    return paid;
  }

  async handleWebhook(input: {
    providerId: PaymentProviderId;
    rawBody: Buffer;
    headers: Readonly<Record<string, string | string[] | undefined>>;
    requestId: string;
  }): Promise<{ accepted: true; processed: boolean; duplicate: boolean }> {
    const provider = this.#providers.get(input.providerId);
    if (!provider?.verifyWebhook) {
      throw new BillingDomainError(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Webhook مزود الدفع غير متاح.",
      );
    }

    let event;
    try {
      event = provider.verifyWebhook(input.rawBody, input.headers);
    } catch {
      throw new BillingDomainError(
        "WEBHOOK_SIGNATURE_INVALID",
        "توقيع Webhook غير صالح.",
      );
    }
    if (!event) {
      return { accepted: true, processed: false, duplicate: false };
    }

    const claimId = crypto.randomUUID();
    const claimKey = `${input.providerId}:${event.eventId}`;
    const claimed = await this.idempotency.claim(
      "billing-webhook",
      claimKey,
      claimId,
      90 * 24 * 60 * 60,
    );
    if (claimed !== claimId) {
      return { accepted: true, processed: false, duplicate: true };
    }

    try {
      if (event.kind === "subscription") {
        const current =
          await this.repository.findSubscriptionByProviderReference(
            input.providerId,
            event.providerSubscriptionId,
          ) ??
          (event.userId
            ? await this.repository.findSubscription(event.userId)
            : null) ??
          (event.checkoutId
            ? await this.subscriptionFromCheckout(event.checkoutId)
            : null);
        if (!current) {
          throw new BillingDomainError(
            "WEBHOOK_EVENT_INVALID",
            "لا يمكن ربط حدث الاشتراك بحساب داخل MotionPrep.",
          );
        }
        const planId = event.planId ?? current.planId;
        await this.repository.saveSubscription({
          ...current,
          planId,
          status: event.status,
          renewalAt: event.renewalAt,
          provider: input.providerId,
          providerCustomerId: event.providerCustomerId,
          providerSubscriptionId: event.providerSubscriptionId,
          cancelAtPeriodEnd: event.cancelAtPeriodEnd,
          usage: usageForPlan(current.usage, planId),
        });
        await this.audit.record({
          actorUserId: current.userId,
          action: `billing.subscription.${event.status}`,
          targetType: "subscription",
          targetId: current.id,
          outcome: "success",
          reason:
            `provider=${input.providerId};event=${event.eventId};` +
            `external=${event.externalReference};cancel_at_period_end=${event.cancelAtPeriodEnd}`,
          requestId: input.requestId,
        });
        return { accepted: true, processed: true, duplicate: false };
      }

      const checkout = await this.repository.findCheckout(event.checkoutId);
      if (!checkout || checkout.provider !== input.providerId) {
        throw new BillingDomainError(
          "CHECKOUT_NOT_FOUND",
          "جلسة الدفع المرتبطة بالحدث غير موجودة.",
        );
      }
      if (
        (event.amountMinor !== null &&
          event.amountMinor !== checkout.amountMinor) ||
        (event.currency !== null && event.currency !== checkout.currency)
      ) {
        throw new BillingDomainError(
          "WEBHOOK_EVENT_INVALID",
          "قيمة حدث الدفع لا تطابق جلسة الدفع.",
        );
      }

      if (event.status === "paid") {
        if (checkout.status !== "paid") {
          await this.repository.saveCheckout({
            ...checkout,
            status: "paid",
          });
          await this.activateSubscription(checkout.userId, checkout.planId, {
            provider: input.providerId,
            ...(event.providerCustomerId
              ? { providerCustomerId: event.providerCustomerId }
              : {}),
            ...(event.providerSubscriptionId
              ? {
                  providerSubscriptionId:
                    event.providerSubscriptionId,
                }
              : {}),
            ...(event.renewalAt ? { renewalAt: event.renewalAt } : {}),
          });
        }
      } else if (checkout.status !== "paid") {
        await this.repository.saveCheckout({
          ...checkout,
          status: event.status,
        });
      }

      await this.audit.record({
        actorUserId: checkout.userId,
        action: `billing.webhook.${event.status}`,
        targetType: "checkout",
        targetId: checkout.id,
        outcome: "success",
        reason:
          `provider=${input.providerId};event=${event.eventId};` +
          `external=${event.externalReference}`,
        requestId: input.requestId,
      });
      return { accepted: true, processed: true, duplicate: false };
    } catch (error) {
      await this.idempotency.release(
        "billing-webhook",
        claimKey,
        claimId,
      );
      throw error;
    }
  }

  async createCustomerPortal(input: {
    actor: UserSummary;
    returnUrl: string;
    requestId: string;
  }): Promise<{ portalUrl: string }> {
    const subscription = await this.subscription(input.actor.id);
    const provider = subscription.provider
      ? this.#providers.get(subscription.provider)
      : undefined;
    if (
      !provider?.createCustomerPortal ||
      !subscription.providerCustomerId
    ) {
      throw new BillingDomainError(
        "SUBSCRIPTION_NOT_MANAGEABLE",
        "لا يرتبط هذا الاشتراك ببوابة إدارة مستضافة.",
      );
    }
    const result = await provider.createCustomerPortal(
      subscription.providerCustomerId,
      input.returnUrl,
    );
    await this.audit.record({
      actorUserId: input.actor.id,
      action: "billing.portal.created",
      targetType: "subscription",
      targetId: subscription.id,
      outcome: "success",
      reason: `provider=${subscription.provider}`,
      requestId: input.requestId,
    });
    return result;
  }

  private async subscriptionFromCheckout(
    checkoutId: string,
  ): Promise<SubscriptionView | null> {
    const checkout = await this.repository.findCheckout(checkoutId);
    return checkout
      ? this.repository.findSubscription(checkout.userId)
      : null;
  }

  private async activateSubscription(
    userId: string,
    planId: SubscriptionView["planId"],
    providerDetails?: {
      provider: PaymentProviderId;
      providerCustomerId?: string;
      providerSubscriptionId?: string;
      renewalAt?: string;
    },
  ): Promise<void> {
    const current = await this.subscription(userId);
    await this.repository.saveSubscription({
      ...current,
      planId,
      status: "active",
      renewalAt:
        providerDetails?.renewalAt ??
        new Date(
          this.now().getTime() + 30 * 24 * 60 * 60_000,
        ).toISOString(),
      ...(providerDetails
        ? {
            provider: providerDetails.provider,
            ...(providerDetails.providerCustomerId
              ? {
                  providerCustomerId:
                    providerDetails.providerCustomerId,
                }
              : {}),
            ...(providerDetails.providerSubscriptionId
              ? {
                  providerSubscriptionId:
                    providerDetails.providerSubscriptionId,
                }
              : {}),
            cancelAtPeriodEnd: false,
          }
        : {}),
      usage: usageForPlan(current.usage, planId),
    });
  }
}

function usageForPlan(
  current: SubscriptionView["usage"],
  planId: SubscriptionView["planId"],
): SubscriptionView["usage"] {
  const plan = planFor(planId);
  return {
    jobs: current.jobs,
    jobLimit: plan.jobLimit,
    processingMinutes: current.processingMinutes,
    processingMinuteLimit: plan.processingMinuteLimit,
  };
}

function planFor(planId: SubscriptionView["planId"]) {
  const plan = BILLING_PLAN_CATALOG.find((candidate) => candidate.id === planId);
  if (!plan) throw new Error(`Unknown billing plan: ${planId}`);
  return plan;
}
