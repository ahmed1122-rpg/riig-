import assert from "node:assert/strict";
import test from "node:test";
import {
  integrationEndpoints,
  integrationPort,
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
