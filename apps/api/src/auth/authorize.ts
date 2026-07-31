import type { UserRole, UserSummary } from "@motionprep/contracts";
import type { FastifyRequest } from "fastify";
import { AuthDomainError, SESSION_COOKIE_NAME, type AuthService } from "./auth-service.js";

export async function requireUser(
  request: FastifyRequest,
  auth: AuthService,
): Promise<UserSummary> {
  return (await auth.session(request.cookies[SESSION_COOKIE_NAME])).user;
}

export async function requireRole(
  request: FastifyRequest,
  auth: AuthService,
  roles: readonly UserRole[],
): Promise<UserSummary> {
  const user = await requireUser(request, auth);
  if (!roles.includes(user.role)) {
    throw new AuthDomainError(
      "SESSION_INVALID",
      "ليس لديك صلاحية لتنفيذ هذا الإجراء.",
    );
  }
  return user;
}

