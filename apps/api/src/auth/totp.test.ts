import { describe, expect, it } from "vitest";
import {
  createOtpAuthUri,
  createTotpCode,
  generateTotpSecret,
  verifyTotpCode,
} from "./totp.js";

describe("TOTP", () => {
  it("generates and verifies a six-digit code within the allowed window", () => {
    const secret = generateTotpSecret(Buffer.alloc(20, 11));
    const timestamp = Date.UTC(2026, 6, 28, 12, 0, 0);
    const code = createTotpCode(secret, timestamp);

    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotpCode(secret, code, timestamp)).toBe(true);
    expect(verifyTotpCode(secret, code, timestamp + 60_000)).toBe(false);
  });

  it("creates a standards-compatible enrollment URI", () => {
    const uri = createOtpAuthUri({
      issuer: "MotionPrep",
      account: "creator@example.com",
      secret: "JBSWY3DPEHPK3PXP",
    });
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("issuer=MotionPrep");
    expect(uri).toContain("digits=6");
  });
});
