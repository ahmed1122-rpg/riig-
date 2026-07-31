import type { FastifyReply, FastifyRequest } from "fastify";
import { trySendAuthDomainError } from "../auth/auth-route-error.js";
import { sendApiError } from "./api-response.js";

type CodedDomainError<Code extends string> = Error & {
  readonly code: Code;
};

export function createDomainErrorResponder<
  Code extends string,
  ConstructorArguments extends unknown[],
>(
  DomainError: new (
    ...arguments_: ConstructorArguments
  ) => CodedDomainError<Code>,
  statusForCode: (code: Code) => number,
) {
  return (
    error: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const authError = trySendAuthDomainError(error, request, reply);
    if (authError) return authError;
    if (!(error instanceof DomainError)) throw error;

    return sendApiError(
      reply,
      request.id,
      statusForCode(error.code),
      error.code,
      error.message,
    );
  };
}
