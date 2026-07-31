import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { recordWorkerEvent } from "./worker-events.js";

describe("recordWorkerEvent", () => {
  it("records an event and advances the durable duration histogram atomically", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });

    await recordWorkerEvent(
      { query } as unknown as Pool,
      {
        workerType: "media",
        eventType: "completed",
        jobId: "00000000-0000-4000-8000-000000000001",
        durationMs: 12_500,
      },
    );

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain(
      "INSERT INTO worker_duration_metrics",
    );
    expect(query.mock.calls[0]?.[0]).toContain("ON CONFLICT (worker_type)");
    expect(query.mock.calls[0]?.[1]).toEqual([
      "media",
      "completed",
      "00000000-0000-4000-8000-000000000001",
      12_500,
    ]);
  });
});
