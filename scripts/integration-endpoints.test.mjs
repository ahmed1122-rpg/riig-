import assert from "node:assert/strict";
import test from "node:test";
import {
  integrationEndpoints,
  integrationPort,
  withAvailableIntegrationPorts,
} from "./integration-endpoints.mjs";

test("uses isolated integration ports when supplied", () => {
  assert.deepEqual(
    integrationEndpoints({
      INTEGRATION_POSTGRES_PORT: "56432",
      INTEGRATION_MAILPIT_PORT: "59025",
      INTEGRATION_API_A_PORT: "55101",
      INTEGRATION_API_B_PORT: "55102",
    }),
    {
      apiOrigins: ["http://127.0.0.1:55101", "http://127.0.0.1:55102"],
      mailpitOrigin: "http://127.0.0.1:59025",
      databaseUrl:
        "postgresql://motionprep:motionprep-integration@127.0.0.1:56432/motionprep",
    },
  );
});

test("allocates distinct loopback ports while preserving explicit overrides", async () => {
  const resolved = await withAvailableIntegrationPorts(
    { INTEGRATION_POSTGRES_PORT: "56432" },
    async (count) => {
      assert.equal(count, 3);
      return [59025, 55101, 55102];
    },
  );

  assert.deepEqual(
    {
      postgres: resolved.INTEGRATION_POSTGRES_PORT,
      mailpit: resolved.INTEGRATION_MAILPIT_PORT,
      apiA: resolved.INTEGRATION_API_A_PORT,
      apiB: resolved.INTEGRATION_API_B_PORT,
    },
    {
      postgres: "56432",
      mailpit: "59025",
      apiA: "55101",
      apiB: "55102",
    },
  );
});

test("rejects duplicate allocator output and explicit port collisions", async () => {
  await assert.rejects(
    withAvailableIntegrationPorts({}, async () => [55101, 55101, 55102, 55103]),
    /invalid port set/u,
  );
  await assert.rejects(
    withAvailableIntegrationPorts(
      {
        INTEGRATION_POSTGRES_PORT: "55101",
        INTEGRATION_MAILPIT_PORT: "55101",
        INTEGRATION_API_A_PORT: "55102",
        INTEGRATION_API_B_PORT: "55103",
      },
    ),
    /must be distinct/u,
  );
});

test("rejects malformed or out-of-range integration ports", () => {
  assert.throws(
    () => integrationPort({ PORT: "5432/path" }, "PORT", 1),
    /valid TCP port/u,
  );
  assert.throws(
    () => integrationPort({ PORT: "65536" }, "PORT", 1),
    /between 1 and 65535/u,
  );
});
