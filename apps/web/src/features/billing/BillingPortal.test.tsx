/** @vitest-environment jsdom */

import { BILLING_PLAN_CATALOG } from "@motionprep/contracts";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeSandboxCheckout,
  createBillingPortal,
  createHostedCheckout,
  getBillingConfiguration,
  getCheckout,
  getSubscription,
} from "../../lib/api";
import BillingPortal from "./BillingPortal";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>(
    "../../lib/api",
  );
  return {
    ...actual,
    completeSandboxCheckout: vi.fn(),
    createBillingPortal: vi.fn(),
    createHostedCheckout: vi.fn(),
    getBillingConfiguration: vi.fn(),
    getCheckout: vi.fn(),
    getSubscription: vi.fn(),
  };
});

const checkoutId = "89a8e97e-a0a9-4a69-8d54-cb46ba9a36d0";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  vi.mocked(getBillingConfiguration).mockResolvedValue({
    mode: "live",
    providers: ["stripe"],
    plans: BILLING_PLAN_CATALOG,
  });
  vi.mocked(getSubscription).mockResolvedValue({
    planId: "starter",
    status: "active",
    renewalAt: "2026-09-01T00:00:00.000Z",
    usage: {
      jobs: 0,
      jobLimit: 5,
      processingMinutes: 0,
      processingMinuteLimit: 30,
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BillingPortal checkout return", () => {
  it("does not show success when the URL has no owned checkout id", async () => {
    window.history.replaceState(
      {},
      "",
      "/?billingReturn=1&payment=success",
    );

    render(
      <BillingPortal
        authenticated
        onRequireAuth={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(/لم نعرض نجاحًا غير مؤكد/u),
    ).toBeTruthy();
    expect(screen.queryByText("تم تأكيد حالة الدفع")).toBeNull();
    expect(getCheckout).not.toHaveBeenCalled();
  });

  it("shows success only after the owned checkout is paid on the server", async () => {
    window.history.replaceState(
      {},
      "",
      `/?billingReturn=1&payment=success&checkout_id=${checkoutId}`,
    );
    vi.mocked(getCheckout).mockResolvedValue({
      id: checkoutId,
      userId: "18d6b7cc-3c0f-4542-bdc3-c52481909c68",
      provider: "stripe",
      planId: "creator",
      status: "paid",
      currency: "USD",
      amountMinor: 1_900,
      checkoutUrl: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:30:00.000Z",
    });

    render(
      <BillingPortal
        authenticated
        onRequireAuth={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    expect(await screen.findByText("تم تأكيد حالة الدفع")).toBeTruthy();
    expect(getCheckout).toHaveBeenCalledWith(
      checkoutId,
      expect.any(AbortSignal),
    );
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("keeps payment mutations behind explicit user actions", () => {
    render(
      <BillingPortal
        authenticated
        onRequireAuth={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    expect(completeSandboxCheckout).not.toHaveBeenCalled();
    expect(createHostedCheckout).not.toHaveBeenCalled();
    expect(createBillingPortal).not.toHaveBeenCalled();
  });
});
