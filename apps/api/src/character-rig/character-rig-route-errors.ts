import type { FastifyReply, FastifyRequest } from "fastify";
import { InvalidIdempotencyKeyError } from "../http/request-metadata.js";
import { sendApiError } from "../http/api-response.js";
import { CharacterBibleError } from "./character-bible-service.js";
import { CharacterGenerationError } from "./character-generation-service.js";
import { CharacterIdentityBootstrapError } from "./character-identity-bootstrap-service.js";
import { CharacterJobIdempotencyConflictError } from "./character-job-service.js";
import { CharacterReferenceError } from "./character-reference-service.js";
import { CharacterRigCompilerError } from "./character-rig-compiler-service.js";
import { CharacterRigReviewError } from "./character-rig-review-service.js";

export function sendCharacterValidationError(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  return sendApiError(
    reply,
    request.id,
    400,
    "VALIDATION_FAILED",
    "Character Studio request data is invalid.",
  );
}

export function sendCharacterDomainError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (
    error instanceof CharacterBibleError ||
    error instanceof CharacterReferenceError ||
    error instanceof CharacterIdentityBootstrapError ||
    error instanceof CharacterGenerationError ||
    error instanceof CharacterRigCompilerError ||
    error instanceof CharacterRigReviewError ||
    error instanceof CharacterJobIdempotencyConflictError ||
    error instanceof InvalidIdempotencyKeyError
  ) {
    const code =
      "code" in error && typeof error.code === "string"
        ? error.code
        : "CHARACTER_REQUEST_INVALID";
    const conflict =
      code.includes("CONFLICT") ||
      code.includes("REVISION") ||
      code.endsWith("INTEGRITY_FAILED");
    const notFound = code.endsWith("NOT_FOUND");
    return sendApiError(
      reply,
      request.id,
      notFound ? 404 : conflict ? 409 : 422,
      code,
      "Character Studio could not complete the requested operation.",
    );
  }
  throw error;
}
