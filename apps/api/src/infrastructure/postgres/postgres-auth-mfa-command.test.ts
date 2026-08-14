import type { Pool, PoolClient, QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { MfaLoginCommit } from "../../auth/auth-repository.js";
import { commitPostgresMfaLogin } from "./postgres-auth-mfa-command.js";
import { PostgresAuthRepository } from "./postgres-auth-repository.js";

describe("PostgreSQL MFA command", () => {
  it("locks the user then atomically consumes challenge, recovery, and session", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT recovery_code_hashes")) {
        return result([{ recovery_code_hashes: ["recovery-hash"] }]);
      }
      if (sql.includes("SELECT token_hash") || sql.includes("RETURNING token_hash")) {
        return result([{ token_hash: "challenge-hash" }]);
      }
      return result([]);
    });
    const release = vi.fn();
    const pool = mockPool(query, release);

    await expect(
      commitPostgresMfaLogin(pool, commitInput()),
    ).resolves.toBe("committed");

    const statements = query.mock.calls.map(([sql]) => compact(sql));
    expect(statements).toEqual([
      "BEGIN",
      expect.stringMatching(/SELECT recovery_code_hashes .* FOR UPDATE/u),
      expect.stringMatching(/SELECT token_hash .* FOR UPDATE/u),
      expect.stringMatching(/DELETE FROM mfa_challenges .* RETURNING token_hash/u),
      expect.stringMatching(/UPDATE users .* array_remove/u),
      expect.stringMatching(/INSERT INTO sessions/u),
      "DELETE FROM mfa_challenges WHERE user_id = $1",
      "COMMIT",
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("rolls back without writes when the recovery hash lost its CAS race", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT recovery_code_hashes")) {
        return result([{ recovery_code_hashes: [] }]);
      }
      if (sql.includes("SELECT token_hash")) {
        return result([{ token_hash: "challenge-hash" }]);
      }
      return result([]);
    });

    await expect(
      commitPostgresMfaLogin(mockPool(query), commitInput()),
    ).resolves.toBe("recovery_invalid");
    expect(query.mock.calls.map(([sql]) => compact(sql))).toEqual([
      "BEGIN",
      expect.stringMatching(/SELECT recovery_code_hashes .* FOR UPDATE/u),
      expect.stringMatching(/SELECT token_hash .* FOR UPDATE/u),
      "ROLLBACK",
    ]);
  });

  it("rolls back the whole security transition when session insertion fails", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT recovery_code_hashes")) {
        return result([{ recovery_code_hashes: ["recovery-hash"] }]);
      }
      if (sql.includes("SELECT token_hash") || sql.includes("RETURNING token_hash")) {
        return result([{ token_hash: "challenge-hash" }]);
      }
      if (sql.includes("INSERT INTO sessions")) throw new Error("insert failed");
      return result([]);
    });

    await expect(
      commitPostgresMfaLogin(mockPool(query), commitInput()),
    ).rejects.toThrow("insert failed");
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("removes a recovery hash with one PostgreSQL compare-and-swap update", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "user-1" }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const repository = new PostgresAuthRepository({
      query,
    } as unknown as PoolClient);

    await expect(
      repository.consumeRecoveryCode("user-1", "recovery-hash"),
    ).resolves.toBe(true);
    await expect(
      repository.consumeRecoveryCode("user-1", "recovery-hash"),
    ).resolves.toBe(false);
    expect(compact(query.mock.calls[0]?.[0] as string)).toMatch(
      /UPDATE users .*array_remove\(.*ANY\(/u,
    );
  });
});

function commitInput(): MfaLoginCommit {
  return {
    tokenHash: "challenge-hash",
    userId: "user-1",
    now: "2026-08-13T12:00:00.000Z",
    lastLoginAt: "2026-08-13T12:00:00.000Z",
    recoveryCodeHash: "recovery-hash",
    session: {
      tokenHash: "session-hash",
      userId: "user-1",
      createdAt: "2026-08-13T12:00:00.000Z",
      expiresAt: "2026-08-13T13:00:00.000Z",
    },
  };
}

function mockPool(
  query: ReturnType<typeof vi.fn>,
  release = vi.fn(),
): Pool {
  return {
    connect: vi.fn().mockResolvedValue({ query, release }),
  } as unknown as Pool;
}

function compact(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}

function result<Row extends Record<string, unknown>>(
  rows: Row[],
): QueryResult<Row> {
  return { rows, rowCount: rows.length } as QueryResult<Row>;
}
