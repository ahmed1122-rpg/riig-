import type { FastifyInstance } from "fastify";

const CSP_REPORT_CONTENT_TYPES = [
  "application/csp-report",
  "application/reports+json",
];

export async function registerCspReportRoutes(
  app: FastifyInstance,
  options: {
    clientTelemetry?: {
      observeError(kind: string): void;
      observeLcp(milliseconds: number): void;
      observeCspViolation(
        directive: string,
        disposition: string,
        browserFamily: string,
      ): void;
    };
    release?: string;
  } = {},
): Promise<void> {
  for (const contentType of CSP_REPORT_CONTENT_TYPES) {
    app.addContentTypeParser(
      contentType,
      { parseAs: "string", bodyLimit: 16 * 1024 },
      (_request, body, done) => {
        try {
          done(null, JSON.parse(typeof body === "string" ? body : body.toString("utf8")));
        } catch (error) {
          done(error as Error, undefined);
        }
      },
    );
  }
  app.post("/v1/security/csp-report", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const browserFamily = classifyBrowserFamily(request.headers["user-agent"]);
    for (const report of sanitizeCspReports(request.body)) {
      options.clientTelemetry?.observeCspViolation(
        report.effective_directive ?? "unknown",
        report.disposition ?? "unknown",
        browserFamily,
      );
      app.log.warn({
        ...report,
        browser_family: browserFamily,
        release: safeIdentifier(options.release),
      }, "security.csp_violation_reported");
    }
    return reply.status(204).send();
  });
  app.post("/v1/security/client-report", {
    bodyLimit: 16 * 1024,
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const report = sanitizeClientReport(request.body);
    if (report) {
      if (report.kind === "performance") {
        options.clientTelemetry?.observeLcp(
          Number(report.lcp_milliseconds),
        );
      } else {
        options.clientTelemetry?.observeError(String(report.kind));
      }
      if (report.kind === "performance") {
        app.log.info(report, "client.performance_reported");
      } else {
        app.log.warn(report, "client.error_reported");
      }
    }
    return reply.status(204).send();
  });
}

export function sanitizeClientReport(
  value: unknown,
): Record<string, string | number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const kind = ["react", "error", "unhandledrejection", "performance"].includes(
    String(raw.kind),
  )
    ? String(raw.kind)
    : null;
  if (!kind) return null;
  const report: Record<string, string | number> = {
    kind,
    route: safeRoute(raw.route),
    release: safeIdentifier(raw.release),
  };
  if (kind === "performance") {
    const lcp = Number(raw.lcpMilliseconds);
    if (!Number.isFinite(lcp) || lcp < 0 || lcp > 120_000) return null;
    report.lcp_milliseconds = Math.round(lcp);
    return report;
  }
  report.error_name = safeIdentifier(raw.errorName);
  report.message = safeDiagnostic(raw.message, 500);
  report.stack = safeDiagnostic(raw.stack, 4_000);
  report.component_stack = safeDiagnostic(raw.componentStack, 2_000);
  return report;
}

export function sanitizeCspReport(value: unknown): Record<string, string> | null {
  const raw = extractReport(value);
  if (!raw) return null;
  return {
    effective_directive: safeText(
      raw["effective-directive"] ?? raw.effectiveDirective,
    ),
    violated_directive: safeText(
      raw["violated-directive"] ?? raw.violatedDirective,
    ),
    document_origin: safeOrigin(raw["document-uri"] ?? raw.documentURL),
    blocked_origin: safeOrigin(raw["blocked-uri"] ?? raw.blockedURL),
    disposition: safeText(raw.disposition),
  };
}

export function sanitizeCspReports(value: unknown): Record<string, string>[] {
  const values = Array.isArray(value) ? value.slice(0, 20) : [value];
  return values
    .map((candidate) => sanitizeCspReport(candidate))
    .filter((report): report is Record<string, string> => report !== null);
}

export function classifyBrowserFamily(userAgent: string | undefined): string {
  if (!userAgent) return "unknown";
  if (/Firefox\//u.test(userAgent)) return "firefox";
  if (/(?:Chrome|Chromium|CriOS|Edg)\//u.test(userAgent)) return "chromium";
  if (/AppleWebKit\//u.test(userAgent)) return "webkit";
  return "unknown";
}

function extractReport(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, unknown>;
  if (root["csp-report"] && typeof root["csp-report"] === "object") {
    return root["csp-report"] as Record<string, unknown>;
  }
  const body = root.body;
  return body && typeof body === "object"
    ? body as Record<string, unknown>
    : root;
}

function safeOrigin(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048) return "unknown";
  if (["inline", "eval", "data", "blob"].includes(value)) return value;
  try {
    return new URL(value).origin;
  } catch {
    return "unknown";
  }
}

function safeText(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[^A-Za-z0-9 _-]/gu, "").slice(0, 120)
    : "unknown";
}

function safeIdentifier(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[^A-Za-z0-9_.-]/gu, "").slice(0, 128) || "unknown"
    : "unknown";
}

function safeRoute(value: unknown): string {
  if (typeof value !== "string") return "/";
  const route = value.split(/[?#]/u, 1)[0] ?? "/";
  return route.startsWith("/")
    ? redactIdentifiers(route).slice(0, 256)
    : "/";
}

function safeDiagnostic(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "unknown";
  return redactIdentifiers(value)
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, "[redacted-email]")
    .replace(/https?:\/\/[^\s)]+/gu, (url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.origin}${redactIdentifiers(parsed.pathname)}`;
      } catch {
        return "[redacted-url]";
      }
    })
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .slice(0, maximum);
}

function redactIdentifiers(value: string): string {
  return value
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
      "[redacted-id]",
    )
    .replace(/\b[a-f0-9]{32,64}\b/giu, "[redacted-id]");
}
