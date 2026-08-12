import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { RetentionCleanupReport } from "./retention-cleanup.js";
import { loadRetentionConfig } from "./retention-config.js";
import {
  PostgresRetentionRunner,
} from "./retention-runtime.js";
import { runRetentionScheduler } from "./retention-scheduler.js";

describe("retention scheduling", () => {
  it("loads bounded defaults and explicit retention settings", () => {
    expect(loadRetentionConfig({})).toMatchObject({
      RETENTION_BATCH_SIZE: 100,
      RETENTION_RUN_INTERVAL_MINUTES: 60,
      JOB_RETENTION_DAYS: 90,
    });
    expect(
      loadRetentionConfig({
        RETENTION_BATCH_SIZE: "25",
        RETENTION_RUN_INTERVAL_MINUTES: "15",
        JOB_RETENTION_DAYS: "30",
      }),
    ).toMatchObject({
      RETENTION_BATCH_SIZE: 25,
      RETENTION_RUN_INTERVAL_MINUTES: 15,
      JOB_RETENTION_DAYS: 30,
    });
  });

  it("runs immediately and stops without waiting for the interval", async () => {
    const shutdown = new AbortController();
    const run = vi.fn().mockResolvedValue(null);
    const reports: Array<RetentionCleanupReport | null> = [];

    await runRetentionScheduler({
      intervalMilliseconds: 60_000,
      signal: shutdown.signal,
      run,
      onReport(report) {
        reports.push(report);
        shutdown.abort();
      },
      onError: vi.fn(),
    });

    expect(run).toHaveBeenCalledOnce();
    expect(reports).toEqual([null]);
  });

  it("skips cleanup when another scheduler owns the advisory lock", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ acquired: false }] });
    const release = vi.fn();
    const pool = {
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as unknown as Pool;
    const cleanup = { run: vi.fn() };
    const runner = new PostgresRetentionRunner(
      pool,
      cleanup as never,
    );

    await expect(runner.run()).resolves.toBeNull();
    expect(cleanup.run).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it("records a successful cleanup and releases its advisory lock", async () => {
    const lockQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const statusQuery = vi.fn().mockResolvedValue({ rows: [] });
    const pool = {
      connect: vi.fn().mockResolvedValue({ query: lockQuery, release }),
      query: statusQuery,
    } as unknown as Pool;
    const report = {
      checkedAt: "2026-07-31T00:00:00.000Z",
      uploadsPurged: 0,
      artifactsPurged: 0,
      database: {},
      failures: [],
    } as unknown as RetentionCleanupReport;
    const cleanup = { run: vi.fn().mockResolvedValue(report) };
    const runner = new PostgresRetentionRunner(pool, cleanup as never, 60_000);

    await expect(runner.run()).resolves.toBe(report);

    expect(statusQuery).toHaveBeenCalledTimes(2);
    expect(statusQuery.mock.calls[0]?.[0]).toContain("last_started_at");
    expect(statusQuery.mock.calls[1]?.[0]).toContain("last_succeeded_at");
    expect(lockQuery.mock.calls[1]?.[0]).toContain("pg_advisory_unlock");
    expect(release).toHaveBeenCalledOnce();
  });

  it("surfaces both cleanup and failure-status persistence errors", async () => {
    const cleanupError = new Error("object storage unavailable");
    const recordingError = new Error("database unavailable");
    const lockQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const statusQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(recordingError);
    const pool = {
      connect: vi.fn().mockResolvedValue({ query: lockQuery, release }),
      query: statusQuery,
    } as unknown as Pool;
    const cleanup = { run: vi.fn().mockRejectedValue(cleanupError) };
    const runner = new PostgresRetentionRunner(pool, cleanup as never, 60_000);

    const failure = await runner.run().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      cleanupError,
      recordingError,
    ]);
    expect(lockQuery.mock.calls[1]?.[0]).toContain("pg_advisory_unlock");
    expect(release).toHaveBeenCalledOnce();
  });
});
