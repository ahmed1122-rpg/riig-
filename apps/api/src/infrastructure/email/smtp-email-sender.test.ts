import { describe, expect, it } from "vitest";
import { passwordResetEmailContent } from "./smtp-email-sender.js";

describe("SMTP password-reset content", () => {
  it("creates multipart Arabic content with a readable UTC expiry", () => {
    const content = passwordResetEmailContent({
      recipient: "owner@example.com",
      resetUrl: "https://studio.example.com/reset?token=abc&next=%3Cscript%3E",
      expiresAt: "2026-08-01T18:30:00.000Z",
    });

    expect(content.subject).toContain("إعادة تعيين");
    expect(content.text).toContain("UTC");
    expect(content.text).not.toContain("2026-08-01T18:30:00.000Z");
    expect(content.html).toContain('lang="ar" dir="rtl"');
    expect(content.html).toContain("&amp;next=");
    expect(content.html).not.toContain("<script>");
  });
});
