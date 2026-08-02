import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresOperationalStatusProvider } from "./postgres-operational-status.js";

describe("PostgresOperationalStatusProvider", () => {
  it("combines recent events with monotonic duration counters", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            instance_id: "media-1",
            worker_type: "media",
            release_version: "sha-test",
            concurrency: 2,
            resident_memory_bytes: "1000",
            heap_used_bytes: "500",
            cpu_user_microseconds: "1500000",
            cpu_system_microseconds: "500000",
            last_seen_at: "2026-07-29T00:00:00.000Z",
            stale: false,
          },
          {
            instance_id: "document-1",
            worker_type: "document",
            release_version: "sha-test",
            concurrency: 1,
            resident_memory_bytes: "2000",
            heap_used_bytes: "800",
            cpu_user_microseconds: "2500000",
            cpu_system_microseconds: "750000",
            last_seen_at: "2026-07-29T00:00:00.000Z",
            stale: false,
          },
          {
            instance_id: "export-1",
            worker_type: "export",
            release_version: "sha-test",
            concurrency: 1,
            resident_memory_bytes: "3000",
            heap_used_bytes: "900",
            cpu_user_microseconds: "3500000",
            cpu_system_microseconds: "1000000",
            last_seen_at: "2026-07-29T00:00:00.000Z",
            stale: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            queue: "processing-media",
            queued: "3",
            active: "1",
            failed: "2",
            oldest_queued_seconds: "301.5",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            worker_type: "media",
            event_type: "retry",
            count: "4",
          },
          {
            worker_type: "media",
            event_type: "lease_lost",
            count: "1",
          },
          {
            worker_type: "media",
            event_type: "failed",
            count: "2",
          },
          {
            worker_type: "media",
            event_type: "completed",
            count: "20",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            worker_type: "media",
            completed_count: "9",
            duration_sum_ms: "12500",
            duration_buckets: ["1", "2", "4", "8", "9", "9", "9", "9"],
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            task: "retention",
            last_started_at: "2026-07-29T00:00:00.000Z",
            last_succeeded_at: "2026-07-29T00:01:00.000Z",
            last_failed_at: null,
            last_error: null,
            stale: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            queued: "3",
            sending: "1",
            failed: "2",
            oldest_queued_seconds: "65.5",
            retries_last_hour: "4",
            failures_last_hour: "2",
          },
        ],
      });
    const provider = new PostgresOperationalStatusProvider({
      query,
    } as unknown as Pool);

    const snapshot = await provider.snapshot();

    expect(snapshot.status).toBe("ready");
    expect(snapshot.workers[0]).toMatchObject({
      residentMemoryBytes: 1000,
      heapUsedBytes: 500,
      cpuUserSeconds: 1.5,
      cpuSystemSeconds: 0.5,
    });
    expect(snapshot.queues[0]).toMatchObject({
      queue: "processing-media",
      queued: 3,
      active: 1,
      failed: 2,
      oldestQueuedSeconds: 301.5,
      retriesLastHour: 4,
      failuresLastHour: 2,
      completionsLastHour: 20,
      leaseLossesLastHour: 1,
      duration: {
        count: 9,
        sumSeconds: 12.5,
        buckets: [1, 2, 4, 8, 9, 9, 9, 9],
      },
    });
    expect(snapshot.maintenance).toMatchObject({
      task: "retention",
      stale: false,
    });
    expect(snapshot.emailOutbox).toEqual({
      queued: 3,
      sending: 1,
      failed: 2,
      oldestQueuedSeconds: 65.5,
      retriesLastHour: 4,
      failuresLastHour: 2,
    });
    expect(query).toHaveBeenCalledTimes(6);
    expect(query.mock.calls[3]?.[0]).toContain("worker_duration_metrics");
    expect(query.mock.calls[4]?.[0]).toContain("maintenance_status");
    expect(query.mock.calls[5]?.[0]).toContain("email_outbox");
  });

  it("reports degraded status when a required worker type is absent", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const provider = new PostgresOperationalStatusProvider({
      query,
    } as unknown as Pool);

    await expect(provider.snapshot()).resolves.toMatchObject({
      status: "degraded",
      workers: [],
      queues: [],
    });
  });
});
