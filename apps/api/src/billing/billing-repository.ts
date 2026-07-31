import type {
  CheckoutSession,
  SubscriptionView,
} from "@motionprep/contracts";

export interface BillingRepository {
  findSubscription(userId: string): Promise<SubscriptionView | null>;
  findSubscriptionByProviderReference(
    provider: SubscriptionView["provider"],
    providerSubscriptionId: string,
  ): Promise<SubscriptionView | null>;
  listSubscriptions(limit: number): Promise<SubscriptionView[]>;
  saveSubscription(subscription: SubscriptionView): Promise<void>;
  findCheckout(id: string): Promise<CheckoutSession | null>;
  listCheckouts(limit: number): Promise<CheckoutSession[]>;
  saveCheckout(checkout: CheckoutSession): Promise<void>;
}

export class InMemoryBillingRepository implements BillingRepository {
  readonly #subscriptions = new Map<string, SubscriptionView>();
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

  async findCheckout(id: string): Promise<CheckoutSession | null> {
    return this.#checkouts.get(id) ?? null;
  }

  async listCheckouts(limit: number): Promise<CheckoutSession[]> {
    return [...this.#checkouts.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.max(1, Math.min(limit, 200)));
  }

  async saveCheckout(checkout: CheckoutSession): Promise<void> {
    this.#checkouts.set(checkout.id, checkout);
  }
}
