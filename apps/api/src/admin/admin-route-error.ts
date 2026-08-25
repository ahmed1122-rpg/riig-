import type { FastifyReply, FastifyRequest } from "fastify";
import { AuthDomainError } from "../auth/auth-service.js";

export function sendAdminAuthError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!(error instanceof AuthDomainError)) throw error;
  const status = error.code === "USER_NOT_FOUND"
    ? 404
    : error.code === "SESSION_INVALID"
      ? 401
      : 403;
  return reply.status(status).send({
    data: null,
    error: {
      code: error.code,
      message: error.message,
      requestId: request.id,
    },
  });
}
