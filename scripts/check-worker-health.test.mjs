import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkerHealthDatabaseUrl } from "./check-worker-health.mjs";

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
