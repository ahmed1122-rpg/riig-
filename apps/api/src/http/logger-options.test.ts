import { describe, expect, it } from "vitest";
import {
  createHttpLoggerOptions,
  HTTP_LOG_REDACTION_PATHS,
} from "./logger-options.js";

describe("HTTP logger redaction", () => {
  it("redacts credentials, cookies, MFA material, and reset tokens", () => {
    expect(HTTP_LOG_REDACTION_PATHS).toEqual(
      expect.arrayContaining([
        "req.headers.authorization",
        "req.headers.cookie",
        "req.body.password",
        "req.body.currentPassword",
        "req.body.newPassword",
        "req.body.token",
        "req.body.challengeToken",
        "req.body.setupToken",
        "req.body.code",
        "res.headers.set-cookie",
      ]),
    );
    expect(createHttpLoggerOptions("production")).toMatchObject({
      level: "info",
      redact: { censor: "[REDACTED]" },
    });
  });

  it("keeps test output silent", () => {
    expect(createHttpLoggerOptions("test")).toBe(false);
  });
});
