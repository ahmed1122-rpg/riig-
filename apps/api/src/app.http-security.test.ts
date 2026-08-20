import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

describe("HTTP security contracts", () => {
  it("prevents caching dynamic API responses unless a route declares a policy", async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: "test" }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/capabilities",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");

    await app.close();
  });

  it("does not trust a caller-supplied request identifier", async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: "test" }));
    const response = await app.inject({
      method: "GET",
      url: "/missing",
      headers: { "x-request-id": "attacker-controlled" },
    });
    const payload = response.json();

    expect(response.headers["x-request-id"]).not.toBe("attacker-controlled");
    expect(payload.error.requestId).toBe(response.headers["x-request-id"]);

    await app.close();
  });

  it("blocks a cross-origin mutation when a session cookie is present", async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: "test" }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: {
        cookie: "motionprep_session=untrusted",
        origin: "https://evil.example",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe(
      "CROSS_ORIGIN_MUTATION_BLOCKED",
    );

    await app.close();
  });

  it("exposes sanitized CSP violation counters to private metrics", async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: "test" }));
    const report = await app.inject({
      method: "POST",
      url: "/v1/security/csp-report",
      headers: {
        "content-type": "application/reports+json",
        "user-agent": "Mozilla/5.0 Chrome/140.0 Safari/537.36",
      },
      payload: JSON.stringify([
        {
          body: {
            effectiveDirective: "style-src-attr",
            blockedURL: "https://private.example/path?token=secret",
            disposition: "enforce",
          },
        },
      ]),
    });
    const metrics = await app.inject({
      method: "GET",
      url: "/internal/metrics",
    });

    expect(report.statusCode).toBe(204);
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain(
      'motionprep_csp_violations_total{directive="style-src-attr",disposition="enforce",browser="chromium",release="development"} 1',
    );
    expect(metrics.body).not.toContain("private.example");

    await app.close();
  });
});
