import { describe, expect, it, vi } from "vitest";
import type { CheckoutSummary } from "../../lib/api";
import {
  classifyCheckoutStatus,
  waitForCheckoutResolution,
} from "./checkoutReturn";

const checkout = (status: CheckoutSummary["status"]): CheckoutSummary => ({
  id: "89a8e97e-a0a9-4a69-8d54-cb46ba9a36d0",
  userId: "18d6b7cc-3c0f-4542-bdc3-c52481909c68",
  provider: "stripe",
  planId: "creator",
  status,
  currency: "USD",
  amountMinor: 1_900,
  checkoutUrl: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2026-08-01T00:30:00.000Z",
});

describe("checkout return verification", () => {
  it("classifies only terminal server states", () => {
    expect(classifyCheckoutStatus("paid")).toBe("success");
    expect(classifyCheckoutStatus("failed")).toBe("failure");
    expect(classifyCheckoutStatus("cancelled")).toBe("failure");
    expect(classifyCheckoutStatus("pending")).toBeNull();
    expect(classifyCheckoutStatus("redirect_required")).toBeNull();
  });

  it("waits for the owned checkout to become paid", async () => {
    const getCheckout = vi
      .fn()
      .mockResolvedValueOnce(checkout("redirect_required"))
      .mockResolvedValueOnce(checkout("paid"));
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(
      waitForCheckoutResolution(checkout("paid").id, {
        getCheckout,
        wait,
        attempts: 3,
      }),
    ).resolves.toBe("success");
    expect(getCheckout).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
  });

  it("does not invent success while the webhook is delayed", async () => {
    const getCheckout = vi
      .fn()
      .mockResolvedValue(checkout("redirect_required"));

    await expect(
      waitForCheckoutResolution(checkout("paid").id, {
        getCheckout,
        wait: async () => undefined,
        attempts: 2,
      }),
    ).resolves.toBe("delayed");
    expect(getCheckout).toHaveBeenCalledTimes(2);
  });
});
