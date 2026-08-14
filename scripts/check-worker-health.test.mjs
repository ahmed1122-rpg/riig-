import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  isWorkerInstanceHealthy,
  validateWorkerHealthDatabaseUrl,
  validateWorkerHealthIdentity,
} from "./check-worker-health.mjs";

test("worker health accepts both PostgreSQL schemes with production TLS", () => {
  for (const protocol of ["postgresql", "postgres"]) {
    assert.deepEqual(
      validateWorkerHealthDatabaseUrl(
        `${protocol}://user:password@db.example.com/motionprep?sslmode=verify-full`,
        "production",
      ),
      [],
    );
  }
});

test("worker health fails closed for plaintext production database URLs", () => {
  assert.match(
    validateWorkerHealthDatabaseUrl(
      "postgresql://user:password@db.example.com/motionprep",
      "production",
    ).join(" "),
    /require PostgreSQL TLS/u,
  );
});

test("worker health requires the exact instance and release identity", async () => {
  assert.deepEqual(
    validateWorkerHealthIdentity("document:123:abc", "a".repeat(40)),
    [],
  );
  assert.equal(validateWorkerHealthIdentity("", "development").length, 2);
  const query = mock.fn(async (_sql, values) => {
    assert.deepEqual(values, ["document", "document:123:abc", "a".repeat(40)]);
    return { rows: [{ healthy: true }] };
  });
  assert.equal(
    await isWorkerInstanceHealthy(
      { query },
      {
        workerType: "document",
        instanceId: "document:123:abc",
        releaseVersion: "a".repeat(40),
      },
    ),
    true,
  );
});
