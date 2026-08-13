import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { UserRecord } from "../../auth/auth-repository.js";
import { PostgresAuthRepository } from "./postgres-auth-repository.js";

const databaseUrl = requireEnvironment("INTEGRATION_DATABASE_URL");
const NOW = "2026-08-13T12:00:00.000Z";
const EXPIRES_AT = "2026-08-13T13:00:00.000Z";
const USER_ID = "00000000-0000-4000-8000-000000000001";

describe("PostgreSQL authentication atomicity", () => {
  let pool: Pool;
  let repository: PostgresAuthRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 20 });
    repository = new PostgresAuthRepository(pool);
    await pool.query("SELECT 1");
  });

  beforeEach(async () => {
    await resetFixture();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("commits only one session from 20 concurrent uses of one challenge", async () => {
    for (let iteration = 0; iteration < 20; iteration += 1) {
      if (iteration > 0) await resetFixture();
      await repository.saveMfaChallenge({
        tokenHash: `challenge-hash-${iteration}`,
        userId: USER_ID,
        expiresAt: EXPIRES_AT,
      });
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          repository.commitMfaLogin({
            tokenHash: `challenge-hash-${iteration}`,
            userId: USER_ID,
            now: NOW,
            lastLoginAt: NOW,
            session: {
              tokenHash: `session-${iteration}-hash-${index}`,
              userId: USER_ID,
              createdAt: NOW,
              expiresAt: EXPIRES_AT,
            },
          }),
        ),
      );

      expect(
        results.filter((result) => result === "committed"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result === "challenge_invalid"),
      ).toHaveLength(19);
      const sessionCount = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM sessions WHERE user_id = $1",
        [USER_ID],
      );
      expect(sessionCount.rows).toEqual([{ count: "1" }]);
    }
  });

  it("allows one of 20 concurrent CAS updates to consume a recovery hash", async () => {
    for (let iteration = 0; iteration < 20; iteration += 1) {
      if (iteration > 0) await resetFixture();
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          repository.consumeRecoveryCode(USER_ID, "recovery-hash"),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(results.filter((consumed) => !consumed)).toHaveLength(19);
    }
  });

  async function resetFixture(): Promise<void> {
    await pool.query("TRUNCATE TABLE users CASCADE");
    await repository.saveUser(userFixture());
  }
});

function userFixture(): UserRecord {
  return {
    id: USER_ID,
    name: "PostgreSQL MFA",
    email: "postgres-mfa@example.test",
    role: "creator",
    status: "active",
    passwordHash: "not-used",
    mfaEnabled: true,
    mfaSecretCiphertext: "not-used",
    recoveryCodeHashes: ["recovery-hash"],
    createdAt: NOW,
    lastLoginAt: null,
    deletionRequestedAt: null,
    deletedAt: null,
  };
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for integration tests.`);
  return value;
}
