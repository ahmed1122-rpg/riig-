/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeMfaLogin, login } from "../../lib/api";
import AuthGateway from "./AuthGateway";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>(
    "../../lib/api",
  );
  return {
    ...actual,
    completeMfaLogin: vi.fn(),
    login: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("AuthGateway MFA challenge", () => {
  it("disables verification and explains the state after expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
    vi.mocked(login).mockResolvedValue({
      kind: "mfa_required",
      challengeToken: "challenge-token",
      expiresAt: "2026-08-13T12:00:02.000Z",
    });
    render(<AuthGateway onAuthenticated={vi.fn()} onBack={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), {
      target: { value: "person@example.com" },
    });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), {
      target: { value: "Correct-Horse-42!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /متابعة آمنة/u }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "تحقق بخطوة إضافية" })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(
      (screen.getByRole("button", {
        name: "تحقق وادخل",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("انتهت صلاحية");
    expect(completeMfaLogin).not.toHaveBeenCalled();
  });

  it("distinguishes an invalid code from an unavailable server", async () => {
    vi.mocked(login).mockResolvedValue({
      kind: "mfa_required",
      challengeToken: "challenge-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    vi.mocked(completeMfaLogin).mockRejectedValue(new Error("unavailable"));
    render(<AuthGateway onAuthenticated={vi.fn()} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), {
      target: { value: "person@example.com" },
    });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), {
      target: { value: "Correct-Horse-42!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /متابعة آمنة/u }));
    await waitFor(() => screen.getByLabelText("رمز التحقق"));
    fireEvent.change(screen.getByLabelText("رمز التحقق"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "تحقق وادخل" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "خطأ في الخادم",
    );
  });
});
