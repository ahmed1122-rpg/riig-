/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAdminAudit,
  getAdminBilling,
  getAdminExports,
  getAdminOverview,
  getAdminProcessing,
  getAdminSystem,
  getAdminUsers,
} from "../../lib/api";
import AdminPanel from "./AdminPanel";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>(
    "../../lib/api",
  );
  return {
    ...actual,
    getAdminAudit: vi.fn(),
    getAdminBilling: vi.fn(),
    getAdminExports: vi.fn(),
    getAdminOverview: vi.fn(),
    getAdminProcessing: vi.fn(),
    getAdminSystem: vi.fn(),
    getAdminUsers: vi.fn(),
  };
});

beforeEach(() => {
  vi.mocked(getAdminAudit).mockResolvedValue([]);
  vi.mocked(getAdminBilling).mockResolvedValue({
    subscriptions: [],
    checkouts: [],
  });
  vi.mocked(getAdminExports).mockResolvedValue([]);
  vi.mocked(getAdminProcessing).mockResolvedValue([]);
  vi.mocked(getAdminSystem).mockResolvedValue({} as never);
  vi.mocked(getAdminUsers).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AdminPanel request lifecycle", () => {
  it("aborts the previous view request before loading the next view", async () => {
    vi.mocked(getAdminOverview).mockImplementationOnce(
      (signal) =>
        new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    render(
      <AdminPanel role="admin" onExit={vi.fn()} onNotify={vi.fn()} />,
    );
    await waitFor(() => expect(getAdminOverview).toHaveBeenCalledOnce());
    const overviewSignal = vi.mocked(getAdminOverview).mock.calls[0]?.[0];

    fireEvent.click(screen.getByRole("button", { name: /المستخدمون/u }));

    await waitFor(() => expect(getAdminUsers).toHaveBeenCalledOnce());
    expect(overviewSignal?.aborted).toBe(true);
    expect(getAdminUsers).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(screen.getByRole("heading", { name: "المستخدمون" })).toBeTruthy();
  });
});
