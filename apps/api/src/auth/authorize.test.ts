import { describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import { AuthDomainError, type AuthService } from "./auth-service.js";
import { requireRole } from "./authorize.js";
import { trySendAuthDomainError } from "./auth-route-error.js";

const creator = {
  id: "user-1",
  name: "Creator",
  email: "creator@example.test",
  role: "creator" as const,
  status: "active" as const,
  mfaEnabled: false,
  createdAt: "2026-08-20T00:00:00.000Z",
  lastLoginAt: null,
};

describe("authorization error semantics", () => {
  it("uses a forbidden domain error without invalidating a valid session", async () => {
    const auth = {
      session: vi.fn().mockResolvedValue({ user: creator }),
    } as unknown as AuthService;
    const request = {
      cookies: { motionprep_session: "valid-session" },
    } as unknown as FastifyRequest;

    await expect(requireRole(request, auth, ["admin"])).rejects.toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
    expect(auth.session).toHaveBeenCalledWith("valid-session");
  });

  it.each([
    ["SESSION_INVALID", 401],
    ["AUTHORIZATION_DENIED", 403],
  ] as const)("maps %s to HTTP %i", (code, expectedStatus) => {
    const sent: unknown[] = [];
    const reply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn((body: unknown) => {
        sent.push(body);
        return body;
      }),
    };
    const request = { id: "request-1" };

    trySendAuthDomainError(
      new AuthDomainError(code, "denied"),
      request as FastifyRequest,
      reply as never,
    );

    expect(reply.status).toHaveBeenCalledWith(expectedStatus);
    expect(sent[0]).toMatchObject({ error: { code } });
  });
});
