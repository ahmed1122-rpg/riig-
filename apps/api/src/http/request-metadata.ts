import type { FastifyRequest } from "fastify";

const idempotencyControlCharacters = /[\u0000-\u001F\u007F]/u;

export class InvalidIdempotencyKeyError extends Error {
  readonly statusCode = 400;

  constructor() {
    super(
      "Idempotency keys must contain 8 to 128 non-control characters without surrounding whitespace.",
    );
  }
}

export function requestIdempotencyKey(
  request: Pick<FastifyRequest, "headers" | "id">,
): string {
  const header = request.headers["x-idempotency-key"];
  if (header === undefined) return `request:${request.id}`;
  if (
    typeof header !== "string" ||
    header.length < 8 ||
    header.length > 128 ||
    header.trim() !== header ||
    idempotencyControlCharacters.test(header)
  ) {
    throw new InvalidIdempotencyKeyError();
  }
  return header;
}
