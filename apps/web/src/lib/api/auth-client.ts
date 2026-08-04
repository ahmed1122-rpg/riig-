import { ApiError, request } from "./transport";
import type { SessionUser } from "./models";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@motionprep/contracts";

export async function getSession(): Promise<SessionUser | null> {
  try {
    const session = await request<{ user: SessionUser }>("/v1/auth/session");
    return session.user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export type LoginResult =
  | { kind: "session"; user: SessionUser }
  | {
      kind: "mfa_required";
      challengeToken: string;
      expiresAt: string;
    };

export async function login(
  email: string,
  password: string,
): Promise<LoginResult> {
  const result = await request<
    | { user: SessionUser }
    | {
        mfaRequired: true;
        challengeToken: string;
        expiresAt: string;
      }
  >("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return "mfaRequired" in result
    ? {
        kind: "mfa_required",
        challengeToken: result.challengeToken,
        expiresAt: result.expiresAt,
      }
    : { kind: "session", user: result.user };
}

export async function register(
  name: string,
  email: string,
  password: string,
): Promise<SessionUser> {
  const session = await request<{ user: SessionUser }>("/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name,
      email,
      password,
      legal: {
        accepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
        privacyVersion: CURRENT_PRIVACY_VERSION,
      },
    }),
  });
  return session.user;
}

export interface AccountDataExport {
  schemaVersion: "1";
  generatedAt: string;
  account: SessionUser;
  legal: {
    termsVersion: string | null;
    privacyVersion: string | null;
    acceptedAt: string | null;
  };
  projects: unknown[];
  sourceVersions: unknown[];
  exports: unknown[];
  subscriptions: unknown[];
  checkoutSessions: unknown[];
  auditEvents: unknown[];
}

export function exportAccountData(): Promise<AccountDataExport> {
  return request("/v1/account/export");
}

export function deleteAccount(password: string): Promise<{
  requestId: string;
  status: "processing" | "failed" | "completed";
}> {
  return request("/v1/account", {
    method: "DELETE",
    body: JSON.stringify({ password, confirmation: "DELETE" }),
  });
}

export async function completeMfaLogin(
  challengeToken: string,
  code: string,
): Promise<SessionUser> {
  const session = await request<{ user: SessionUser }>(
    "/v1/auth/mfa/challenge",
    {
      method: "POST",
      body: JSON.stringify({ challengeToken, code }),
    },
  );
  return session.user;
}

export function requestPasswordReset(email: string): Promise<{
  accepted: true;
  message: string;
}> {
  return request("/v1/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function confirmPasswordReset(
  token: string,
  newPassword: string,
): Promise<{ passwordReset: true; reauthenticationRequired: true }> {
  return request("/v1/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ token, newPassword }),
  });
}

export function logout(): Promise<{ loggedOut: true }> {
  return request("/v1/auth/logout", { method: "POST" });
}

export function beginMfaSetup(): Promise<{
  setupToken: string;
  secret: string;
  otpAuthUri: string;
  expiresAt: string;
}> {
  return request("/v1/auth/mfa/setup", { method: "POST" });
}

export function confirmMfaSetup(
  setupToken: string,
  code: string,
): Promise<{
  recoveryCodes: string[];
  reauthenticationRequired: true;
}> {
  return request("/v1/auth/mfa/setup/confirm", {
    method: "POST",
    body: JSON.stringify({ setupToken, code }),
  });
}

export function disableMfa(
  password: string,
  code: string,
): Promise<{ disabled: true; reauthenticationRequired: true }> {
  return request("/v1/auth/mfa/disable", {
    method: "POST",
    body: JSON.stringify({ password, code }),
  });
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ passwordChanged: true; reauthenticationRequired: true }> {
  return request("/v1/auth/password/change", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}
