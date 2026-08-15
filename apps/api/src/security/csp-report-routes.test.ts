import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import {
  classifyBrowserFamily,
  registerCspReportRoutes,
  sanitizeCspReport,
  sanitizeCspReports,
  sanitizeClientReport,
} from "./csp-report-routes.js";

describe("CSP report sanitization", () => {
  it("retains policy diagnostics but removes paths and query secrets", () => {
    expect(sanitizeCspReport({
      "csp-report": {
        "effective-directive": "style-src-elem",
        "violated-directive": "style-src 'self'",
        "document-uri": "https://studio.example.test/auth?token=secret",
        "blocked-uri": "https://cdn.example.test/private/path?key=secret",
        disposition: "report",
      },
    })).toEqual({
      effective_directive: "style-src-elem",
      violated_directive: "style-src self",
      document_origin: "https://studio.example.test",
      blocked_origin: "https://cdn.example.test",
      disposition: "report",
    });
  });

  it("rejects non-object noise", () => {
    expect(sanitizeCspReport("secret-token")).toBeNull();
  });

  it("accepts bounded Reporting API batches", () => {
    expect(sanitizeCspReports([
      { body: { effectiveDirective: "style-src-attr", disposition: "report" } },
      { body: { effectiveDirective: "img-src", disposition: "enforce" } },
    ])).toEqual([
      expect.objectContaining({
        effective_directive: "style-src-attr",
        disposition: "report",
      }),
      expect.objectContaining({
        effective_directive: "img-src",
        disposition: "enforce",
      }),
    ]);
  });

  it("classifies browser engines into bounded metric labels", () => {
    expect(classifyBrowserFamily("Mozilla/5.0 Firefox/141.0")).toBe("firefox");
    expect(
      classifyBrowserFamily("Mozilla/5.0 Chrome/140.0 Safari/537.36"),
    ).toBe("chromium");
    expect(
      classifyBrowserFamily("Mozilla/5.0 AppleWebKit/605.1 Safari/605.1"),
    ).toBe("webkit");
    expect(classifyBrowserFamily("private-client/1.0")).toBe("unknown");
  });

  it("accepts the browser CSP media type without echoing the report", async () => {
    const app = Fastify({ logger: false });
    await registerCspReportRoutes(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/security/csp-report",
      headers: { "content-type": "application/csp-report" },
      payload: JSON.stringify({
        "csp-report": {
          "effective-directive": "style-src-attr",
          "document-uri": "https://studio.example.test/?token=secret",
        },
      }),
    });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
  });

  it("redacts client routes, identifiers, email, and URL queries", () => {
    expect(sanitizeClientReport({
      kind: "react",
      route: "/projects/89a8e97e-a0a9-4a69-8d54-cb46ba9a36d0?token=secret",
      release: "a".repeat(40),
      errorName: "TypeError",
      message: "failed for person@example.com",
      stack: "at https://studio.example.test/app.js?token=secret",
      componentStack: "at Workspace",
    })).toEqual(expect.objectContaining({
      kind: "react",
      route: "/projects/[redacted-id]",
      message: "failed for [redacted-email]",
      stack: "at https://studio.example.test/app.js",
    }));
  });

  it("accepts bounded LCP telemetry and rejects impossible values", () => {
    expect(sanitizeClientReport({
      kind: "performance",
      route: "/",
      release: "development",
      lcpMilliseconds: 2_345.6,
    })).toMatchObject({ lcp_milliseconds: 2_346 });
    expect(sanitizeClientReport({
      kind: "performance",
      lcpMilliseconds: 999_999,
    })).toBeNull();
  });

  it("records sanitized browser errors and LCP without echoing payloads", async () => {
    const app = Fastify({ logger: false });
    const clientTelemetry = {
      observeError: vi.fn(),
      observeLcp: vi.fn(),
      observeCspViolation: vi.fn(),
    };
    await registerCspReportRoutes(app, { clientTelemetry });
    const errorResponse = await app.inject({
      method: "POST",
      url: "/v1/security/client-report",
      payload: {
        kind: "error",
        route: "/projects/private?token=secret",
        release: "test",
        errorName: "TypeError",
        message: "failed",
        stack: "at Workspace",
        componentStack: "",
      },
    });
    const performanceResponse = await app.inject({
      method: "POST",
      url: "/v1/security/client-report",
      payload: {
        kind: "performance",
        route: "/",
        release: "test",
        lcpMilliseconds: 2_500,
      },
    });

    expect(errorResponse.statusCode).toBe(204);
    expect(errorResponse.body).toBe("");
    expect(performanceResponse.statusCode).toBe(204);
    expect(clientTelemetry.observeError).toHaveBeenCalledWith("error");
    expect(clientTelemetry.observeLcp).toHaveBeenCalledWith(2_500);
    await app.close();
  });

  it("records CSP violations using bounded metric labels", async () => {
    const app = Fastify({ logger: false });
    const clientTelemetry = {
      observeError: vi.fn(),
      observeLcp: vi.fn(),
      observeCspViolation: vi.fn(),
    };
    await registerCspReportRoutes(app, { clientTelemetry });
    const response = await app.inject({
      method: "POST",
      url: "/v1/security/csp-report",
      headers: {
        "content-type": "application/reports+json",
        "user-agent": "Mozilla/5.0 Firefox/141.0",
      },
      payload: JSON.stringify([
        { body: { effectiveDirective: "style-src-attr", disposition: "report" } },
      ]),
    });

    expect(response.statusCode).toBe(204);
    expect(clientTelemetry.observeCspViolation).toHaveBeenCalledWith(
      "style-src-attr",
      "report",
      "firefox",
    );
    await app.close();
  });
});
