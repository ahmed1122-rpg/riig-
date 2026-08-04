import type {
  CheckoutSession,
  SubscriptionView,
} from "@motionprep/contracts";

export interface BillingStatusSummary {
  activeSubscriptions: number;
  pendingCheckouts: number;
  paidCheckouts: number;
}

export interface BillingRepository {
  findSubscription(userId: string): Promise<SubscriptionView | null>;
  findSubscriptionByProviderReference(
    provider: SubscriptionView["provider"],
    providerSubscriptionId: string,
  ): Promise<SubscriptionView | null>;
  listSubscriptions(limit: number): Promise<SubscriptionView[]>;
  saveSubscription(subscription: SubscriptionView): Promise<void>;
  saveSubscriptionFromProvider(
    subscription: SubscriptionView,
    event: ProviderEventVersion,
  ): Promise<boolean>;
  findCheckout(id: string): Promise<CheckoutSession | null>;
  listCheckouts(limit: number): Promise<CheckoutSession[]>;
  summarizeStatuses(): Promise<BillingStatusSummary>;
  ensurePendingCheckout(checkout: CheckoutSession): Promise<CheckoutSession>;
  completePendingCheckout(
    checkout: CheckoutSession,
  ): Promise<{ checkout: CheckoutSession; transitioned: boolean }>;
  saveCheckout(checkout: CheckoutSession): Promise<void>;
}

export interface ProviderEventVersion {
  occurredAt: number;
  eventId: string;
}

export class InMemoryBillingRepository implements BillingRepository {
  readonly #subscriptions = new Map<string, SubscriptionView>();
  readonly #providerVersions = new Map<string, ProviderEventVersion>();
  readonly #checkouts = new Map<string, CheckoutSession>();

  async findSubscription(userId: string): Promise<SubscriptionView | null> {
    return this.#subscriptions.get(userId) ?? null;
  }

  async findSubscriptionByProviderReference(
    provider: SubscriptionView["provider"],
    providerSubscriptionId: string,
  ): Promise<SubscriptionView | null> {
    return (
      [...this.#subscriptions.values()].find(
        (subscription) =>
          subscription.provider === provider &&
          subscription.providerSubscriptionId === providerSubscriptionId,
      ) ?? null
    );
  }

  async listSubscriptions(limit: number): Promise<SubscriptionView[]> {
    return [...this.#subscriptions.values()].slice(
      0,
      Math.max(1, Math.min(limit, 200)),
    );
  }

  async saveSubscription(subscription: SubscriptionView): Promise<void> {
    this.#subscriptions.set(subscription.userId, subscription);
  }

  async saveSubscriptionFromProvider(
    subscription: SubscriptionView,
    event: ProviderEventVersion,
  ): Promise<boolean> {
    const current = this.#providerVersions.get(subscription.userId);
    if (current && compareProviderEvents(event, current) <= 0) return false;
    this.#subscriptions.set(subscription.userId, subscription);
    this.#providerVersions.set(subscription.userId, event);
    return true;
  }

  async findCheckout(id: string): Promise<CheckoutSession | null> {
    return this.#checkouts.get(id) ?? null;
  }

  async listCheckouts(limit: number): Promise<CheckoutSession[]> {
    return [...this.#checkouts.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.max(1, Math.min(limit, 200)));
  }

  async summarizeStatuses(): Promise<BillingStatusSummary> {
    const subscriptions = [...this.#subscriptions.values()];
    const checkouts = [...this.#checkouts.values()];
    return {
      activeSubscriptions: subscriptions.filter((subscription) =>
        ["active", "trialing"].includes(subscription.status),
      ).length,
      pendingCheckouts: checkouts.filter((checkout) =>
        ["pending", "redirect_required"].includes(checkout.status),
      ).length,
      paidCheckouts: checkouts.filter((checkout) => checkout.status === "paid")
        .length,
    };
  }

  async ensurePendingCheckout(
    checkout: CheckoutSession,
  ): Promise<CheckoutSession> {
    const existing = this.#checkouts.get(checkout.id);
    if (existing) return existing;
    this.#checkouts.set(checkout.id, checkout);
    return checkout;
  }

  async completePendingCheckout(
    checkout: CheckoutSession,
  ): Promise<{ checkout: CheckoutSession; transitioned: boolean }> {
    const current = this.#checkouts.get(checkout.id);
    if (!current) {
      throw new Error("Pending checkout no longer exists.");
    }
    if (current.status !== "pending") {
      return { checkout: current, transitioned: false };
    }
    this.#checkouts.set(checkout.id, checkout);
    return { checkout, transitioned: true };
  }

  async saveCheckout(checkout: CheckoutSession): Promise<void> {
    this.#checkouts.set(checkout.id, checkout);
  }
}

function compareProviderEvents(
  left: ProviderEventVersion,
  right: ProviderEventVersion,
): number {
  if (left.occurredAt !== right.occurredAt) {
    return left.occurredAt - right.occurredAt;
  }
  return left.eventId.localeCompare(right.eventId);
}
