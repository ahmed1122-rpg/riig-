import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  acquireMigrationAdvisoryLock,
  applyMigrationTimeouts,
  loadMigrationDatabaseUrl,
  loadMigrationRuntimePolicy,
  releaseMigrationAdvisoryLock,
} from "./migration-runtime-policy.js";

describe("migration runtime policy", () => {
  it("requires a dedicated TLS migration role in production", () => {
    expect(
      loadMigrationDatabaseUrl({
        NODE_ENV: "production",
        MIGRATION_DATABASE_URL:
          "postgresql://motionprep_migrator:secret@db:5432/motionprep?sslmode=verify-full",
        DATABASE_URL:
          "postgresql://motionprep_runtime:secret@db:5432/motionprep?sslmode=verify-full",
      }),
    ).toContain("motionprep_migrator");
    expect(() =>
      loadMigrationDatabaseUrl({
        NODE_ENV: "production",
        DATABASE_URL:
          "postgresql://motionprep_runtime:secret@db:5432/motionprep?sslmode=require",
      }),
    ).toThrow(/MIGRATION_DATABASE_URL is required/u);
    expect(() =>
      loadMigrationDatabaseUrl({
        NODE_ENV: "production",
        MIGRATION_DATABASE_URL:
          "postgresql://motionprep_runtime:other@db:5432/motionprep?sslmode=require",
        DATABASE_URL:
          "postgresql://motionprep_runtime:secret@db:5432/motionprep?sslmode=require",
      }),
    ).toThrow(/database role separate/u);
    expect(() =>
      loadMigrationDatabaseUrl({
        NODE_ENV: "production",
        MIGRATION_DATABASE_URL:
          "postgresql://motionprep_migrator:secret@db:5432/motionprep",
      }),
    ).toThrow(/explicitly require TLS/u);
  });

  it("keeps DATABASE_URL as a non-production migration fallback", () => {
    expect(
      loadMigrationDatabaseUrl({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://local:local@127.0.0.1:5432/motionprep",
      }),
    ).toContain("postgresql://local");
  });

  it("bounds lock waits and allows a conservative hour for long statements", () => {
    expect(loadMigrationRuntimePolicy({})).toEqual({
      advisoryLockTimeoutMs: 30_000,
      lockTimeoutMs: 15_000,
      statementTimeoutMs: 3_600_000,
    });
    expect(
      loadMigrationRuntimePolicy({
        MIGRATION_ADVISORY_LOCK_TIMEOUT_MS: "45000",
        MIGRATION_LOCK_TIMEOUT_MS: "20000",
        MIGRATION_STATEMENT_TIMEOUT_MS: "900000",
      }),
    ).toEqual({
      advisoryLockTimeoutMs: 45_000,
      lockTimeoutMs: 20_000,
      statementTimeoutMs: 900_000,
    });
    expect(
      loadMigrationRuntimePolicy({ MIGRATION_STATEMENT_TIMEOUT_MS: "0" })
        .statementTimeoutMs,
    ).toBe(0);
  });

  it("rejects malformed and unsafe timeout settings", () => {
    expect(() =>
      loadMigrationRuntimePolicy({ MIGRATION_LOCK_TIMEOUT_MS: "forever" }),
    ).toThrow(/MIGRATION_LOCK_TIMEOUT_MS must be an integer/u);
    expect(() =>
      loadMigrationRuntimePolicy({
        MIGRATION_ADVISORY_LOCK_TIMEOUT_MS: "999",
      }),
    ).toThrow(/MIGRATION_ADVISORY_LOCK_TIMEOUT_MS/u);
    expect(() =>
      loadMigrationRuntimePolicy({ MIGRATION_STATEMENT_TIMEOUT_MS: "86400001" }),
    ).toThrow(/MIGRATION_STATEMENT_TIMEOUT_MS/u);
  });

  it("polls a non-blocking advisory lock until it is acquired", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: false }] })
      .mockResolvedValueOnce({ rows: [{ acquired: false }] })
      .mockResolvedValueOnce({ rows: [{ acquired: true }] });
    let clock = 0;
    const wait = vi.fn(async (milliseconds: number) => {
      clock += milliseconds;
    });

    await acquireMigrationAdvisoryLock(asClient(query), 1_000, {
      now: () => clock,
      wait,
    });

    expect(query).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 250);
    expect(wait).toHaveBeenNthCalledWith(2, 250);
  });

  it("fails with an actionable error after the advisory deadline", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ acquired: false }] });
    let clock = 0;

    await expect(
      acquireMigrationAdvisoryLock(asClient(query), 1_000, {
        now: () => clock,
        wait: async (milliseconds) => {
          clock += milliseconds;
        },
      }),
    ).rejects.toThrow(/Another migration runner may still be active/u);
    expect(query).toHaveBeenCalledTimes(5);
  });

  it("uses parameterized session and transaction-local timeouts", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await applyMigrationTimeouts(
      asClient(query),
      { lockTimeoutMs: 12_000, statementTimeoutMs: 0 },
      true,
    );

    expect(query).toHaveBeenNthCalledWith(
      1,
      "SELECT set_config('lock_timeout', $1, $2)",
      ["12000ms", true],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      "SELECT set_config('statement_timeout', $1, $2)",
      ["0", true],
    );

    query.mockClear();
    await applyMigrationTimeouts(
      asClient(query),
      { lockTimeoutMs: 15_000, statementTimeoutMs: 3_600_000 },
      false,
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      "SELECT set_config('statement_timeout', $1, $2)",
      ["3600000ms", false],
    );
  });

  it("never sends unlock when lock acquisition did not succeed", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ unlocked: true }] });

    await expect(
      releaseMigrationAdvisoryLock(asClient(query), false),
    ).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
    await expect(
      releaseMigrationAdvisoryLock(asClient(query), true),
    ).resolves.toBe(true);
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain("pg_advisory_unlock");
  });
});

function asClient(query: ReturnType<typeof vi.fn>): Pick<PoolClient, "query"> {
  return { query } as unknown as Pick<PoolClient, "query">;
}
