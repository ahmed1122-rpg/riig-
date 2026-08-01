import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "./ocr-holdout-policy.mjs";

test("serializes object keys deterministically at every depth", () => {
  const left = { z: 1, nested: { b: 2, a: 1 }, a: true };
  const right = { a: true, nested: { a: 1, b: 2 }, z: 1 };

  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(
    canonicalJson(left),
    '{"a":true,"nested":{"a":1,"b":2},"z":1}',
  );
});

test("preserves array order while canonicalizing array entries", () => {
  assert.equal(
    canonicalJson([{ b: 2, a: 1 }, "value"]),
    '[{"a":1,"b":2},"value"]',
  );
});
