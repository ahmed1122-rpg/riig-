export const HTTP_LOG_REDACTION_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers.x-api-key",
  "req.headers.x-idempotency-key",
  "req.body.password",
  "req.body.currentPassword",
  "req.body.newPassword",
  "req.body.token",
  "req.body.challengeToken",
  "req.body.setupToken",
  "req.body.code",
  "res.headers.set-cookie",
  "response.headers.set-cookie",
  "err.config.headers.authorization",
  "err.config.headers.Authorization",
] as const;

export function createHttpLoggerOptions(
  environment: "development" | "test" | "production",
) {
  if (environment === "test") return false as const;
  return {
    level: environment === "production" ? "info" : "debug",
    redact: {
      paths: [...HTTP_LOG_REDACTION_PATHS],
      censor: "[REDACTED]",
    },
  };
}
