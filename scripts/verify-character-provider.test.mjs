import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  runCharacterProviderReadiness,
  verifyCapabilities,
} from "./verify-character-provider.mjs";

const policy = {
  schemaVersion: 1,
  requiredProtocol: "async-v1",
  autoscaling: {
    requireScaleToZero: true,
    requiredMinReplicas: 0,
    maximumReplicas: 2,
    maximumTargetConcurrency: 1,
  },
  operations: {
    maximumColdStartMilliseconds: 180_000,
    maximumQueueMilliseconds: 300_000,
    maximumOperationMilliseconds: 900_000,
  },
  privacy: {
    maximumInputRetentionSeconds: 3_600,
    maximumOutputRetentionSeconds: 3_600,
    requireCustomerDataTrainingDisabled: true,
  },
};

const capabilities = {
  schemaVersion: 1,
  protocols: ["async-v1"],
  autoscaling: {
    scaleToZero: true,
    minReplicas: 0,
    maxReplicas: 2,
    targetConcurrency: 1,
  },
  operationBudgets: {
    coldStartMilliseconds: 120_000,
    queueMilliseconds: 240_000,
    operationMilliseconds: 600_000,
  },
  privacy: {
    inputRetentionSeconds: 0,
    outputRetentionSeconds: 0,
    customerDataTraining: false,
  },
};

function environment(overrides = {}) {
  return {
    CHARACTER_RIG_ENABLED: "true",
    CHARACTER_INFERENCE_URL: "https://gpu.example.test/private/",
    CHARACTER_INFERENCE_API_KEY: "test-provider-key-123456",
    CHARACTER_INFERENCE_PROTOCOL: "async-v1",
    ...overrides,
  };
}

describe("Character GPU Serverless provider readiness", () => {
  it("records a fail-closed gate when Character Rig remains disabled", async () => {
    const evidence = await runCharacterProviderReadiness({
      environment: {
        CHARACTER_RIG_ENABLED: "false",
        RELEASE_GIT_SHA: "a".repeat(40),
      },
    });

    assert.deepEqual(evidence.checks, ["feature-disabled"]);
    assert.equal(evidence.enabled, false);
    assert.equal(evidence.verified, false);
  });

  it("verifies capabilities and the async control-plane operation", async () => {
    const calls = [];
    const responses = [
      new Response(JSON.stringify(capabilities), { status: 200 }),
      new Response(
        JSON.stringify({
          operationId: "readiness-operation-1",
          statusUrl: "v1/operations/readiness-operation-1",
          retryAfterMilliseconds: 100,
        }),
        { status: 202 },
      ),
      new Response(
        JSON.stringify({ status: "running", retryAfterMilliseconds: 100 }),
        { status: 202 },
      ),
    ];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      if (calls.length === 4) {
        const submittedProbe = JSON.parse(calls[1].init.body).probeId;
        return new Response(
          JSON.stringify({ status: "succeeded", probeId: submittedProbe }),
          { status: 200 },
        );
      }
      const response = responses.shift();
      assert.ok(response);
      return response;
    };

    const evidence = await runCharacterProviderReadiness({
      environment: environment(),
      fetchImpl,
      delay: async () => undefined,
    });

    assert.equal(evidence.verified, true);
    assert.equal(evidence.protocol, "async-v1");
    assert.equal(evidence.conformancePollCount, 2);
    assert.deepEqual(
      calls.map(({ init }) => init.method),
      ["GET", "POST", "GET", "GET"],
    );
    assert.equal(
      calls[1].init.headers["x-idempotency-key"],
      calls[2].init.headers["x-idempotency-key"],
    );
    assert.equal(
      calls[2].url,
      "https://gpu.example.test/private/v1/operations/readiness-operation-1",
    );
    assert.equal(JSON.stringify(evidence).includes("test-provider-key"), false);
  });

  it("rejects a provider that cannot scale to zero", () => {
    assert.throws(
      () =>
        verifyCapabilities(policy, {
          ...capabilities,
          autoscaling: { ...capabilities.autoscaling, scaleToZero: false },
        }),
      /scale-to-zero/u,
    );
  });

  it("rejects unsafe replica and retention declarations", () => {
    assert.throws(
      () =>
        verifyCapabilities(policy, {
          ...capabilities,
          autoscaling: { ...capabilities.autoscaling, maxReplicas: 3 },
        }),
      /maxReplicas/u,
    );
    assert.throws(
      () =>
        verifyCapabilities(policy, {
          ...capabilities,
          privacy: {
            ...capabilities.privacy,
            inputRetentionSeconds: 7_200,
          },
        }),
      /inputRetentionSeconds/u,
    );
  });

  it("rejects status polling outside the provider origin", async () => {
    const fetchImpl = async (_url, init) =>
      init.method === "GET"
        ? new Response(JSON.stringify(capabilities), { status: 200 })
        : new Response(
            JSON.stringify({
              operationId: "readiness-operation-1",
              statusUrl: "https://attacker.example/steal",
            }),
            { status: 202 },
          );

    await assert.rejects(
      runCharacterProviderReadiness({
        environment: environment(),
        fetchImpl,
        delay: async () => undefined,
      }),
      /same-origin/u,
    );
  });

  it("requires the async protocol explicitly", async () => {
    await assert.rejects(
      runCharacterProviderReadiness({
        environment: environment({ CHARACTER_INFERENCE_PROTOCOL: "direct-v1" }),
      }),
      /async-v1/u,
    );
  });

  it("bounds capability responses without trusting Content-Length", async () => {
    await assert.rejects(
      runCharacterProviderReadiness({
        environment: environment(),
        fetchImpl: async () => new Response("x".repeat(256 * 1024 + 1)),
      }),
      /too large/u,
    );
  });
});
