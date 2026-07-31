import type { FastifyRequest } from "fastify";

export function requestIdempotencyKey(
  request: Pick<FastifyRequest, "headers" | "id">,
): string {
  const header = request.headers["x-idempotency-key"];
  return typeof header === "string" && header.length >= 8 && header.length <= 256
    ? header
    : `request:${request.id}`;
}
