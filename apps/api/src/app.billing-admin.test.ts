import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import {
  createAppTestHarness,
  FakeStripeProvider,
  registerCreator,
  sessionCookie,
} from "./app-test-helpers.js";
import { InMemoryAuthRepository } from "./auth/auth-repository.js";
import { AuthService } from "./auth/auth-service.js";

const harness = createAppTestHarness();

describe("API — الفوترة والإدارة", () => {
  it("creates an idempotent sandbox checkout and upgrades the subscription", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const registered = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        name: "صانع محتوى",
        email: "creator@example.com",
        password: "StrongPass123",
      },
    });
    const cookie = sessionCookie(registered.headers["set-cookie"]);
    const checkoutPayload = {
      providerId: "sandbox-local",
      planId: "creator",
      currency: "EGP",
      returnUrl: "http://localhost:5173/billing/return",
    };
    const checkout = await app.inject({
      method: "POST",
      url: "/v1/billing/checkouts",
      headers: {
        cookie,
        "x-idempotency-key": "checkout-creator-001",
      },
      payload: checkoutPayload,
    });
    const repeated = await app.inject({
      method: "POST",
      url: "/v1/billing/checkouts",
      headers: {
        cookie,
        "x-idempotency-key": "checkout-creator-001",
      },
      payload: checkoutPayload,
    });

    expect(checkout.statusCode).toBe(201);
    expect(checkout.json().data.id).toBe(repeated.json().data.id);
    expect(checkout.json().data.checkoutUrl).toContain("sandbox_checkout");

    const completed = await app.inject({
      method: "POST",
      url: `/v1/billing/checkouts/${checkout.json().data.id}/complete-sandbox`,
      headers: { cookie },
    });
    expect(completed.json().data.status).toBe("paid");

    const subscription = await app.inject({
      method: "GET",
      url: "/v1/billing/subscription",
      headers: { cookie },
    });
    expect(subscription.json().data.planId).toBe("creator");
    expect(subscription.json().data.usage.jobLimit).toBe(100);
  });
  it("uses a signed live webhook as the payment source of truth", async () => {
    const provider = new FakeStripeProvider();
    const app = await harness.build(
      loadConfig({
        NODE_ENV: "test",
        PAYMENT_MODE: "live",
        STRIPE_SECRET_KEY: "sk_test_motionprep",
        STRIPE_WEBHOOK_SECRET: "whsec_motionprep",
      }),
      { paymentProviders: [provider] },
    );
    const cookie = await registerCreator(app, "live-billing@example.com");
    const checkout = await app.inject({
      method: "POST",
      url: "/v1/billing/checkouts",
      headers: {
        cookie,
        "x-idempotency-key": "live-checkout-001",
      },
      payload: {
        providerId: "stripe",
        planId: "creator",
        currency: "USD",
        returnUrl: "http://localhost:5173/billing/return",
      },
    });
    expect(checkout.statusCode).toBe(201);
    expect(checkout.json().data.status).toBe("redirect_required");

    const webhookPayload = JSON.stringify({ eventId: "evt_live_paid_001" });
    const webhook = await app.inject({
      method: "POST",
      url: "/v1/billing/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "x-test-signature": "valid",
      },
      payload: webhookPayload,
    });
    expect(webhook.statusCode).toBe(200);
    expect(provider.receivedRawBody).toBe(true);
    expect(webhook.json().data.processed).toBe(true);

    const repeated = await app.inject({
      method: "POST",
      url: "/v1/billing/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "x-test-signature": "valid",
      },
      payload: webhookPayload,
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().data.duplicate).toBe(true);

    const subscription = await app.inject({
      method: "GET",
      url: "/v1/billing/subscription",
      headers: { cookie },
    });
    expect(subscription.json().data.planId).toBe("creator");
    expect(subscription.json().data).toMatchObject({
      provider: "stripe",
      providerCustomerId: "cus_motionprep",
      providerSubscriptionId: "sub_motionprep",
      renewalAt: "2026-08-28T00:00:00.000Z",
    });

    const portal = await app.inject({
      method: "POST",
      url: "/v1/billing/portal",
      headers: { cookie },
      payload: {
        returnUrl: "http://localhost:5173/billing/return",
      },
    });
    expect(portal.statusCode).toBe(200);
    expect(portal.json().data.portalUrl).toContain(
      "billing.example.test/portal/cus_motionprep",
    );

    const pastDueWebhook = await app.inject({
      method: "POST",
      url: "/v1/billing/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "x-test-signature": "valid",
      },
      payload: JSON.stringify({
        eventId: "evt_subscription_past_due_001",
        kind: "subscription",
        status: "past_due",
      }),
    });
    expect(pastDueWebhook.statusCode).toBe(200);
    const pastDueSubscription = await app.inject({
      method: "GET",
      url: "/v1/billing/subscription",
      headers: { cookie },
    });
    expect(pastDueSubscription.json().data).toMatchObject({
      status: "past_due",
      renewalAt: "2026-09-28T00:00:00.000Z",
      cancelAtPeriodEnd: false,
    });
  });
  it("enforces admin roles and records sensitive access changes", async () => {
    const authRepository = new InMemoryAuthRepository();
    const seed = new AuthService(authRepository);
    await seed.seedUser({
      name: "مسؤول النظام",
      email: "admin@example.com",
      password: "AdminPass123",
      role: "admin",
    });
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }), {
      auth: authRepository,
    });

    const creatorRegistration = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        name: "مستخدم للاختبار",
        email: "target@example.com",
        password: "StrongPass123",
      },
    });
    const targetId = creatorRegistration.json().data.user.id as string;
    const creatorCookie = sessionCookie(
      creatorRegistration.headers["set-cookie"],
    );

    const denied = await app.inject({
      method: "GET",
      url: "/v1/admin/users",
      headers: { cookie: creatorCookie },
    });
    expect(denied.statusCode).toBe(403);

    const adminLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "admin@example.com",
        password: "AdminPass123",
      },
    });
    const adminCookie = sessionCookie(adminLogin.headers["set-cookie"]);
    const overview = await app.inject({
      method: "GET",
      url: "/v1/admin/overview",
      headers: { cookie: adminCookie },
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().data).toMatchObject({
      users: { total: 2, active: 2, suspended: 0 },
      processing: { total: 0, active: 0, failed: 0 },
      billing: {
        activeSubscriptions: 0,
        pendingCheckouts: 0,
        paidCheckouts: 0,
      },
    });

    const protectedAdmin = await app.inject({
      method: "PATCH",
      url: `/v1/admin/users/${adminLogin.json().data.user.id}/access`,
      headers: { cookie: adminCookie },
      payload: {
        role: "support",
        reason: "Regression test for protecting the last active administrator",
      },
    });
    expect(protectedAdmin.statusCode).toBe(403);
    expect(protectedAdmin.json().error.code).toBe("LAST_ADMIN_PROTECTED");

    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/admin/users/${targetId}/access`,
      headers: { cookie: adminCookie },
      payload: {
        status: "suspended",
        reason: "مراجعة أمنية بطلب من فريق الدعم",
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.status).toBe("suspended");

    const audit = await app.inject({
      method: "GET",
      url: "/v1/admin/audit",
      headers: { cookie: adminCookie },
    });
    expect(audit.json().data[0].action).toBe("admin.user.access_updated");
    expect(audit.json().data[0].reason).toContain("مراجعة أمنية");
  });
});
