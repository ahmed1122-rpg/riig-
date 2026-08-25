import type { FastifyReply, FastifyRequest } from "fastify";
import { sendApiError } from "../http/api-response.js";
import { AuthDomainError } from "./auth-service.js";

export function trySendAuthDomainError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  return error instanceof AuthDomainError
    ? sendApiError(
        reply,
        request.id,
        error.code === "AUTHORIZATION_DENIED" ? 403 : 401,
        error.code,
        error.message,
      )
    : undefined;
}
