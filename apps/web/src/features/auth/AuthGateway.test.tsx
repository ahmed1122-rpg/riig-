/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeMfaLogin,
  confirmPasswordReset,
  login,
  verifyEmail,
} from "../../lib/api";
import AuthGateway from "./AuthGateway";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>(
    "../../lib/api",
  );
  return {
    ...actual,
    completeMfaLogin: vi.fn(),
    confirmPasswordReset: vi.fn(),
    login: vi.fn(),
    verifyEmail: vi.fn(),
  };
});

beforeEach(() => {
  window.history.replaceState(null, "", "/");
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

describe("AuthGateway email verification entry", () => {
  it("verifies a direct link and removes only auth tokens safely", async () => {
    const historyState = { preserved: "state" };
    window.history.replaceState(
      historyState,
      "",
      "/?verificationToken=verification-secret&view=projects#details",
    );
    vi.mocked(verifyEmail).mockResolvedValue({
      id: "user-1",
      name: "مستخدم",
      email: "person@example.com",
      role: "creator",
      mfaEnabled: false,
    });
    const onAuthenticated = vi.fn();

    render(
      <AuthGateway
        onAuthenticated={onAuthenticated}
        onBack={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "جارٍ تأكيد بريدك" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(verifyEmail).toHaveBeenCalledWith("verification-secret"),
    );
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
    expect(window.location.search).toBe("?view=projects");
    expect(window.location.hash).toBe("#details");
    expect(window.history.state).toEqual(historyState);
  });

  it("keeps a failed token only in memory and removes it from the URL immediately", async () => {
    window.history.replaceState(
      null,
      "",
      "/?verificationToken=expired-token&view=help",
    );
    vi.mocked(verifyEmail).mockRejectedValue(new Error("expired"));

    render(<AuthGateway onAuthenticated={vi.fn()} onBack={vi.fn()} />);

    expect(
      await screen.findByRole("heading", { name: "تعذر تأكيد البريد" }),
    ).toBeTruthy();
    expect(window.location.search).toBe("?view=help");

    fireEvent.click(
      screen.getByRole("button", { name: "العودة لتسجيل الدخول" }),
    );
    expect(window.location.search).toBe("?view=help");
    expect(
      screen.getByRole("heading", { name: "مرحبًا بعودتك" }),
    ).toBeTruthy();
  });

  it("captures a password-reset token before removing it from browser history", async () => {
    const historyState = { reset: "preserved" };
    window.history.replaceState(
      historyState,
      "",
      "/?token=reset-secret&view=settings#security",
    );
    vi.mocked(confirmPasswordReset).mockResolvedValue({
      passwordReset: true,
      reauthenticationRequired: true,
    });

    render(<AuthGateway onAuthenticated={vi.fn()} onBack={vi.fn()} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "تعيين كلمة مرور جديدة" }),
    ).toBeTruthy();
    expect(window.location.search).toBe("?view=settings");
    expect(window.location.hash).toBe("#security");
    expect(window.history.state).toEqual(historyState);

    fireEvent.change(screen.getByLabelText("كلمة المرور الجديدة"), {
      target: { value: "Correct-Horse-42!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "حفظ والعودة للدخول" }));

    await waitFor(() =>
      expect(confirmPasswordReset).toHaveBeenCalledWith(
        "reset-secret",
        "Correct-Horse-42!",
      ),
    );
  });
});
