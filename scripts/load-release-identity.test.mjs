import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTargetRelease,
  inspectTargetRelease,
} from "./load-release-identity.mjs";

const releaseIdentity = {
  releaseGitSha: "a".repeat(40),
  applicationVersion: "0.1.3",
};
const config = {
  targetOrigin: "https://staging.example.test",
  requestTimeoutMs: 1_000,
  releaseIdentity,
};

test("accepts the exact deployed release identity", async () => {
  const observation = await inspectTargetRelease(config, async () =>
    Response.json({
      data: {
        release: releaseIdentity.releaseGitSha,
        version: releaseIdentity.applicationVersion,
      },
    }),
  );

  assert.equal(observation.passed, true);
  assert.equal(observation.observedReleaseGitSha, releaseIdentity.releaseGitSha);
  assert.doesNotThrow(() => assertTargetRelease(observation));
});

test("fails closed when the release changes or readiness is malformed", async () => {
  const mismatch = await inspectTargetRelease(config, async () =>
    Response.json({
      data: { release: "b".repeat(40), version: "0.1.3" },
    }),
  );
  assert.equal(mismatch.passed, false);
  assert.throws(() => assertTargetRelease(mismatch), /differs/u);

  const malformed = await inspectTargetRelease(
    config,
    async () => new Response("not-json", { status: 200 }),
  );
  assert.equal(malformed.passed, false);
  assert.match(malformed.error, /not JSON/u);
});

test("does not probe local smoke runs without a release policy", async () => {
  let called = false;
  const observation = await inspectTargetRelease(
    { ...config, releaseIdentity: null },
    async () => {
      called = true;
      return Response.json({});
    },
  );
  assert.equal(observation, null);
  assert.equal(called, false);
});
