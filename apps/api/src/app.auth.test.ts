import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import {
  createAppTestHarness,
  registerCreator,
  sessionCookie,
} from "./app-test-helpers.js";
import { InMemoryEmailSender } from "./auth/email-sender.js";
import { AesGcmSecretProtector } from "./auth/secret-protector.js";
import { createTotpCode } from "./auth/totp.js";
import { InMemoryExportRepository } from "./exports/export-repository.js";

const harness = createAppTestHarness();

describe("API — المصادقة والصلاحيات", () => {
  it("requires authentication and prevents cross-account project access", async () => {
    const exports = new InMemoryExportRepository();
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }), { exports });

    const unauthenticated = await app.inject({
      method: "POST",
      url: "/v1/projects",
      payload: { name: "مشروع بلا جلسة", kind: "image" },
    });
    expect(unauthenticated.statusCode).toBe(401);

    const ownerCookie = await registerCreator(app, "owner-a@example.com");
    const otherCookie = await registerCreator(app, "owner-b@example.com");
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie: ownerCookie },
      payload: { name: "مشروع خاص", kind: "image" },
    });
    const projectId = projectResponse.json().data.id as string;

    const otherProjects = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { cookie: otherCookie },
    });
    expect(otherProjects.statusCode).toBe(200);
    expect(otherProjects.json().data).toEqual([]);

    const forbiddenIntent = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: { cookie: otherCookie },
      payload: {
        projectId,
        filename: "private.png",
        contentType: "image/png",
        sizeBytes: 1024,
      },
    });
    expect(forbiddenIntent.statusCode).toBe(404);

    const ownerIntent = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: { cookie: ownerCookie },
      payload: {
        projectId,
        filename: "private.png",
        contentType: "image/png",
        sizeBytes: 1024,
      },
    });
    const uploadId = ownerIntent.json().data.uploadId as string;
    const hiddenUpload = await app.inject({
      method: "GET",
      url: `/v1/uploads/${uploadId}`,
      headers: { cookie: otherCookie },
    });
    expect(hiddenUpload.statusCode).toBe(404);

    const exportId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    await exports.save({
      id: exportId,
      projectId,
      sourceVersionId: crypto.randomUUID(),
      projectKind: "image",
      format: "psd",
      scope: "full-document",
      scale: 1,
      colorProfile: "sRGB",
      namingPresetId: "adobe-default",
      status: "queued",
      progress: 0,
      attempt: 0,
      maxAttempts: 3,
      nextAttemptAt: timestamp,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const ownerExports = await app.inject({
      method: "GET",
      url: "/v1/exports",
      headers: { cookie: ownerCookie },
    });
    const otherExports = await app.inject({
      method: "GET",
      url: "/v1/exports",
      headers: { cookie: otherCookie },
    });
    const hiddenExport = await app.inject({
      method: "POST",
      url: `/v1/exports/${exportId}/cancel`,
      headers: { cookie: otherCookie },
    });
    expect(ownerExports.json().data).toHaveLength(1);
    expect(ownerExports.json().data[0].id).toBe(exportId);
    expect(otherExports.json().data).toEqual([]);
    expect(hiddenExport.statusCode).toBe(404);
  });
  it("registers with a secure cookie, resolves the session, and logs out", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const registered = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        name: "نور أحمد",
        email: "noor@example.com",
        password: "StrongPass123",
      },
    });
    const cookie = sessionCookie(registered.headers["set-cookie"]);
    expect(registered.statusCode).toBe(201);
    expect(cookie).toContain("motionprep_session=");
    expect(registered.headers["set-cookie"]).toContain("HttpOnly");
    expect(registered.headers["set-cookie"]).toContain("SameSite=Lax");

    const session = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie: cookie ?? "" },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().data.user.email).toBe("noor@example.com");
    expect(session.json().data.user.passwordHash).toBeUndefined();

    const logout = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { cookie: cookie ?? "" },
    });
    expect(logout.statusCode).toBe(200);

    const expired = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie: cookie ?? "" },
    });
    expect(expired.statusCode).toBe(401);
  });
  it("enforces the shared password policy at the registration boundary", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const invalidPasswords = [
      "shortA1",
      "lowercaseonly1",
      "UPPERCASEONLY1",
      "NoNumberPassword",
      `ValidStart1${"x".repeat(118)}`,
    ];

    for (const [index, password] of invalidPasswords.entries()) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          name: "سياسة كلمة المرور",
          email: `password-policy-${index}@example.com`,
          password,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_FAILED");
    }
  });
  it("locks repeated login attempts without revealing whether the account exists", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    await registerCreator(app, "locked@example.com");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "locked@example.com",
          password: "WrongPassword123",
        },
      });
      expect(failed.statusCode).toBe(400);
      expect(failed.json().error.code).toBe("INVALID_CREDENTIALS");
    }

    const locked = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "locked@example.com",
        password: "StrongPass123",
      },
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe("ACCOUNT_LOCKED");
  });
  it("enables TOTP MFA and accepts every recovery code only once", async () => {
    const secretProtector = new AesGcmSecretProtector(Buffer.alloc(32, 7));
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }), {
      secretProtector,
    });
    const cookie = await registerCreator(app, "mfa@example.com");

    const setup = await app.inject({
      method: "POST",
      url: "/v1/auth/mfa/setup",
      headers: { cookie },
    });
    expect(setup.statusCode).toBe(200);
    expect(setup.json().data.otpAuthUri).toContain("otpauth://totp/");

    const confirmed = await app.inject({
      method: "POST",
      url: "/v1/auth/mfa/setup/confirm",
      headers: { cookie },
      payload: {
        setupToken: setup.json().data.setupToken,
        code: createTotpCode(setup.json().data.secret),
      },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().data.user.mfaEnabled).toBe(true);
    expect(confirmed.json().data.recoveryCodes).toHaveLength(10);
    const recoveryCode = confirmed.json().data.recoveryCodes[0] as string;

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "mfa@example.com",
        password: "StrongPass123",
      },
    });
    expect(login.statusCode).toBe(202);
    expect(login.json().data.mfaRequired).toBe(true);
    expect(login.headers["set-cookie"]).toBeUndefined();

    const recoveryLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/mfa/challenge",
      payload: {
        challengeToken: login.json().data.challengeToken,
        code: recoveryCode,
      },
    });
    expect(recoveryLogin.statusCode).toBe(200);
    expect(sessionCookie(recoveryLogin.headers["set-cookie"])).toContain(
      "motionprep_session=",
    );

    const repeatedLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "mfa@example.com",
        password: "StrongPass123",
      },
    });
    const repeatedRecovery = await app.inject({
      method: "POST",
      url: "/v1/auth/mfa/challenge",
      payload: {
        challengeToken: repeatedLogin.json().data.challengeToken,
        code: recoveryCode,
      },
    });
    expect(repeatedRecovery.statusCode).toBe(400);
    expect(repeatedRecovery.json().error.code).toBe("MFA_CODE_INVALID");
  });
  it("resets a password with a single-use token and revokes existing sessions", async () => {
    const emailSender = new InMemoryEmailSender();
    const app = await harness.build(
      loadConfig({
        NODE_ENV: "test",
        PASSWORD_RESET_URL: "http://localhost:5173/auth/reset",
      }),
      { emailSender },
    );
    const cookie = await registerCreator(app, "reset@example.com");

    const unknown = await app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/request",
      payload: { email: "unknown@example.com" },
    });
    expect(unknown.statusCode).toBe(202);
    expect(emailSender.passwordResets).toHaveLength(0);

    const requested = await app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/request",
      payload: { email: "reset@example.com" },
    });
    expect(requested.statusCode).toBe(202);
    expect(emailSender.passwordResets).toHaveLength(1);
    const resetToken = new URL(
      emailSender.passwordResets[0]!.resetUrl,
    ).searchParams.get("token")!;

    const confirmed = await app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/confirm",
      payload: {
        token: resetToken,
        newPassword: "NewStrongPass456",
      },
    });
    expect(confirmed.statusCode).toBe(200);

    const previousSession = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie },
    });
    expect(previousSession.statusCode).toBe(401);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/confirm",
      payload: {
        token: resetToken,
        newPassword: "AnotherPass789",
      },
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().error.code).toBe("PASSWORD_RESET_INVALID");

    const oldPassword = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "reset@example.com",
        password: "StrongPass123",
      },
    });
    expect(oldPassword.statusCode).toBe(400);
    const newPassword = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "reset@example.com",
        password: "NewStrongPass456",
      },
    });
    expect(newPassword.statusCode).toBe(200);
  });
});
