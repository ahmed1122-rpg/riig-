import assert from "node:assert/strict";
import { test } from "node:test";
import {
  loadStagingDependencyConfig,
  verifyStagingDependencies,
} from "./verify-staging-dependencies.mjs";

const secureEnvironment = {
  DATABASE_URL:
    "postgresql://motionprep:database-secret@db.example.com:5432/motionprep?sslmode=verify-full",
  REDIS_URL: "rediss://default:redis-secret@cache.example.com:6379",
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_REQUIRE_TLS: "true",
  SMTP_USER: "motionprep",
  SMTP_PASSWORD: "smtp-secret",
  SMTP_FROM: "security@example.com",
};

test("accepts encrypted staging service coordinates", () => {
  const config = loadStagingDependencyConfig(secureEnvironment);

  assert.equal(config.smtp.port, 587);
  assert.equal(config.smtp.requireTls, true);
  assert.match(config.databaseUrl, /sslmode=verify-full/u);
});

test("rejects plaintext database and Redis transports", () => {
  assert.throws(
    () =>
      loadStagingDependencyConfig({
        ...secureEnvironment,
        DATABASE_URL:
          "postgresql://motionprep:secret@db.example.com:5432/motionprep",
      }),
    /sslmode/u,
  );
  assert.throws(
    () =>
      loadStagingDependencyConfig({
        ...secureEnvironment,
        REDIS_URL: "redis://cache.example.com:6379",
      }),
    /rediss/u,
  );
});

test("rejects SMTP without implicit TLS or mandatory STARTTLS", () => {
  assert.throws(
    () =>
      loadStagingDependencyConfig({
        ...secureEnvironment,
        SMTP_REQUIRE_TLS: "false",
      }),
    /TLS|STARTTLS/u,
  );
});

test("runs all probes without exposing credentials", async () => {
  const calls = [];
  const result = await verifyStagingDependencies(secureEnvironment, {
    postgres: async () => calls.push("postgres"),
    redis: async () => calls.push("redis"),
    smtp: async () => calls.push("smtp"),
  });

  assert.deepEqual(calls, ["postgres", "redis", "smtp"]);
  assert.deepEqual(result, ["PostgreSQL", "Redis", "SMTP"]);

  await assert.rejects(
    verifyStagingDependencies(secureEnvironment, {
      postgres: async () => {
        throw new Error(secureEnvironment.DATABASE_URL);
      },
      redis: async () => {},
      smtp: async () => {},
    }),
    (error) => {
      assert.equal(error.message, "PostgreSQL readiness probe failed.");
      assert.doesNotMatch(error.message, /database-secret/u);
      return true;
    },
  );
});
