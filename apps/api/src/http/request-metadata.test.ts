import { describe, expect, it } from "vitest";
import {
  InvalidIdempotencyKeyError,
  requestIdempotencyKey,
} from "./request-metadata.js";

describe("request idempotency metadata", () => {
  it("uses a server request scoped fallback when the header is absent", () => {
    expect(requestIdempotencyKey({ id: "request-1", headers: {} })).toBe(
      "request:request-1",
    );
  });

  it("accepts a bounded caller supplied key", () => {
    const idempotencyKey = ["operation", "123"].join("-");
    expect(
      requestIdempotencyKey({
        id: "request-1",
        headers: { "x-idempotency-key": idempotencyKey },
      }),
    ).toBe(idempotencyKey);
  });

  it.each([
    "short",
    `key-${"x".repeat(125)}`,
    " leading-space",
    "trailing-space ",
    "valid-key\u0000hidden",
  ])("rejects an unsafe key: %j", (key) => {
    expect(() =>
      requestIdempotencyKey({
        id: "request-1",
        headers: { "x-idempotency-key": key },
      }),
    ).toThrow(InvalidIdempotencyKeyError);
  });
});
