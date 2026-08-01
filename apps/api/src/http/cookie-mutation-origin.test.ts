import { describe, expect, it } from "vitest";
import { isCookieMutationOriginAllowed } from "./cookie-mutation-origin.js";

const allowedOrigins = new Set(["https://studio.example.com"]);

describe("cookie mutation origin policy", () => {
  it("allows safe methods and requests without an authenticated cookie", () => {
    expect(isCookieMutationOriginAllowed({
      method: "GET",
      hasSessionCookie: true,
      origin: "https://evil.example",
      allowedOrigins,
      requireOrigin: true,
    })).toBe(true);
    expect(isCookieMutationOriginAllowed({
      method: "POST",
      hasSessionCookie: false,
      origin: "https://evil.example",
      allowedOrigins,
      requireOrigin: true,
    })).toBe(true);
  });

  it("allows an exact configured origin or same-origin referer", () => {
    expect(isCookieMutationOriginAllowed({
      method: "PATCH",
      hasSessionCookie: true,
      origin: "https://studio.example.com",
      allowedOrigins,
      requireOrigin: true,
    })).toBe(true);
    expect(isCookieMutationOriginAllowed({
      method: "DELETE",
      hasSessionCookie: true,
      referer: "https://studio.example.com/projects/1",
      allowedOrigins,
      requireOrigin: true,
    })).toBe(true);
  });

  it("rejects mismatched, malformed, or absent production origins", () => {
    for (const origin of ["https://evil.example", "not-a-url", undefined]) {
      expect(isCookieMutationOriginAllowed({
        method: "POST",
        hasSessionCookie: true,
        ...(origin ? { origin } : {}),
        allowedOrigins,
        requireOrigin: true,
      })).toBe(false);
    }
  });
});
