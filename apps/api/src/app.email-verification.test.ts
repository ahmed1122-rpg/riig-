import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import {
  createAppTestHarness,
  legalAcceptance,
  sessionCookie,
  TEST_PASSWORD,
} from "./app-test-helpers.js";
import { InMemoryEmailSender } from "./auth/email-sender.js";
import { InMemoryAuditRepository } from "./audit/audit-repository.js";

const harness = createAppTestHarness();

describe("email verification and administrator bootstrap", () => {
  it("does not create a session before an email link is consumed once", async () => {
    const sender = new InMemoryEmailSender();
    const audit = new InMemoryAuditRepository();
    const app = await harness.build(
      loadConfig({
        NODE_ENV: "test",
        EMAIL_VERIFICATION_REQUIRED: "true",
        EMAIL_VERIFICATION_URL: "https://studio.example.test/auth",
      }),
      { emailSender: sender, audit },
    );
    const registered = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        name: "Verified creator",
        email: "verified@example.test",
        password: TEST_PASSWORD,
        legal: legalAcceptance,
      },
    });
    expect(registered.statusCode).toBe(201);
    expect(registered.json().data.verificationRequired).toBe(true);
    expect(registered.headers["set-cookie"]).toBeUndefined();

    const link = sender.emailVerifications[0]?.verificationUrl;
    const token = link ? new URL(link).searchParams.get("verificationToken") : null;
    expect(token).toBeTruthy();
    const verified = await app.inject({
      method: "POST",
      url: "/v1/auth/email/verify",
      payload: { token },
    });
    expect(verified.statusCode).toBe(200);
    expect(sessionCookie(verified.headers["set-cookie"])).toContain(
      "motionprep_session=",
    );
    const replay = await app.inject({
      method: "POST",
      url: "/v1/auth/email/verify",
      payload: { token },
    });
    expect(replay.statusCode).toBe(400);
    expect((await audit.list(10))[0]).toMatchObject({
      action: "auth.email.verified",
      outcome: "success",
    });
  });

  it("bootstraps one configured administrator and denies every replay", async () => {
    const token = "one-shot-bootstrap-token-with-entropy";
    const audit = new InMemoryAuditRepository();
    const app = await harness.build(
      loadConfig({
        NODE_ENV: "test",
        ADMIN_BOOTSTRAP_EMAIL: "owner@example.test",
        ADMIN_BOOTSTRAP_TOKEN_HASH: createHash("sha256")
          .update(token)
          .digest("hex"),
      }),
      { audit },
    );
    const payload = {
      name: "Initial owner",
      email: "owner@example.test",
      password: TEST_PASSWORD,
      token,
      legal: legalAcceptance,
    };
    const first = await app.inject({
      method: "POST",
      url: "/v1/auth/admin-bootstrap",
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().data.user.role).toBe("admin");
    const replay = await app.inject({
      method: "POST",
      url: "/v1/auth/admin-bootstrap",
      payload,
    });
    expect(replay.statusCode).toBe(403);
    expect(await audit.list(10)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "auth.admin.bootstrap_completed",
          outcome: "success",
        }),
        expect.objectContaining({
          action: "auth.admin.bootstrap_denied",
          outcome: "denied",
        }),
      ]),
    );
  });
});
