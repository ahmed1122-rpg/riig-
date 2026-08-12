import assert from "node:assert/strict";
import test from "node:test";
import { buildProductionComposeInvocation } from "./run-production-compose.mjs";

test("builds the approved immutable production Compose invocation", () => {
  const invocation = buildProductionComposeInvocation([
    ".env.production",
    "--profile",
    "character-rig",
    "up",
    "-d",
    "worker-character",
  ]);
  assert.equal(invocation.environmentFile.endsWith(".env.production"), true);
  assert.deepEqual(invocation.composeArguments.slice(-5), [
    "--profile",
    "character-rig",
    "up",
    "-d",
    "worker-character",
  ]);
});

test("rejects destructive commands and unknown profiles", () => {
  assert.throws(
    () => buildProductionComposeInvocation([".env.production", "down"]),
    /command is not approved/u,
  );
  assert.throws(
    () =>
      buildProductionComposeInvocation([
        ".env.production",
        "--profile",
        "debug",
        "up",
      ]),
    /profile is not approved/u,
  );
});
