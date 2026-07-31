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
            last_seen_at: "2026-07-29T00:00:00.000Z",
            stale: false,
          },
          {
            instance_id: "document-1",
            worker_type: "document",
            release_version: "sha-test",
            concurrency: 1,
            last_seen_at: "2026-07-29T00:00:00.000Z",
            stale: false,
          },
          {
            instance_id: "export-1",
            worker_type: "export",
            release_version: "sha-test",
            concurrency: 1,
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
      });
    const provider = new PostgresOperationalStatusProvider({
      query,
    } as unknown as Pool);

    const snapshot = await provider.snapshot();

    expect(snapshot.status).toBe("ready");
    expect(snapshot.queues[0]).toMatchObject({
      queue: "processing-media",
      queued: 3,
      active: 1,
      failed: 2,
      oldestQueuedSeconds: 301.5,
      retriesLastHour: 4,
      leaseLossesLastHour: 1,
      duration: {
        count: 9,
        sumSeconds: 12.5,
        buckets: [1, 2, 4, 8, 9, 9, 9, 9],
      },
    });
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[3]?.[0]).toContain("worker_duration_metrics");
  });

  it("reports degraded status when a required worker type is absent", async () => {
    const query = vi
      .fn()
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
