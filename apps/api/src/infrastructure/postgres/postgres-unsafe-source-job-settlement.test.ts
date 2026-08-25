import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { failJobsForUnsafeSource } from "./postgres-unsafe-source-job-settlement.js";

describe("failJobsForUnsafeSource", () => {
  it("uses a dense parameter list when clearing the active project job", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const settledAt = "2026-08-22T17:00:00.000Z";

    await failJobsForUnsafeSource(
      { query } as unknown as PoolClient,
      {
        projectId: "project-1",
        sourceVersionId: "source-1",
        errorCode: "MALWARE_DETECTED",
        settledAt,
      },
    );

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0]?.[1]).toEqual([
      "project-1",
      "source-1",
      "MALWARE_DETECTED",
      settledAt,
    ]);
    expect(query.mock.calls[2]?.[0]).toContain("updated_at = $3");
    expect(query.mock.calls[2]?.[0]).not.toContain("$4");
    expect(query.mock.calls[2]?.[1]).toEqual([
      "project-1",
      "source-1",
      settledAt,
    ]);
  });
});
