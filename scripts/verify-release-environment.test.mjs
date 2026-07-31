import assert from "node:assert/strict";
import test from "node:test";
import { validateReleaseEnvironment } from "./verify-release-environment.mjs";

test("accepts two digest-qualified release references", () => {
  const source = [
    `RUNTIME_IMAGE_REF=ghcr.io/example/runtime@sha256:${"a".repeat(64)}`,
    `WEB_IMAGE_REF=ghcr.io/example/web@sha256:${"b".repeat(64)}`,
  ].join("\n");
  assert.deepEqual(validateReleaseEnvironment(source), []);
});

test("rejects mutable tags and legacy variables", () => {
  const violations = validateReleaseEnvironment(
    "RUNTIME_IMAGE_REF=example/runtime:latest\nWEB_IMAGE_REF=example/web:v1\nIMAGE_TAG=v1",
  );
  assert.equal(violations.length, 3);
});
