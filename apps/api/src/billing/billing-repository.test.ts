import type { SubscriptionView } from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryBillingRepository } from "./billing-repository.js";

const subscription: SubscriptionView = {
  id: "c907e2bf-a942-41f8-9f55-e0cbcbeaa7df",
  userId: "230c186d-af51-48f0-b886-27d84d4cfe9f",
  planId: "creator",
  status: "active",
  renewalAt: "2026-09-01T00:00:00.000Z",
  usage: {
    jobs: 1,
    jobLimit: 100,
    processingMinutes: 2,
    processingMinuteLimit: 600,
  },
  provider: "stripe",
  providerCustomerId: "cus_motionprep",
  providerSubscriptionId: "sub_motionprep",
  cancelAtPeriodEnd: false,
};

describe("InMemoryBillingRepository provider ordering", () => {
  it("atomically ignores an older provider event", async () => {
    const repository = new InMemoryBillingRepository();
    expect(
      await repository.saveSubscriptionFromProvider(
        { ...subscription, status: "past_due" },
        { occurredAt: 200, eventId: "evt_new" },
      ),
    ).toBe(true);
    expect(
      await repository.saveSubscriptionFromProvider(
        subscription,
        { occurredAt: 100, eventId: "evt_old" },
      ),
    ).toBe(false);
    expect(
      await repository.saveSubscriptionFromProvider(
        subscription,
        { occurredAt: 200, eventId: "evt_new" },
      ),
    ).toBe(false);
    expect(
      await repository.findSubscription(subscription.userId),
    ).toMatchObject({ status: "past_due" });
  });
});
