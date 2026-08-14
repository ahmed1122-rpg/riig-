import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresCharacterJobRepository } from "./postgres-character-job-repository.js";

describe("PostgresCharacterJobRepository", () => {
  it("fences claims for accounts whose deletion has started", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repository = new PostgresCharacterJobRepository({ query } as unknown as Pool);

    await expect(repository.claimNext(
      "worker-1",
      "2026-08-13T10:00:00.000Z",
      "2026-08-13T10:01:00.000Z",
    )).resolves.toBeNull();

    expect(String(query.mock.calls[0]?.[0])).toContain("deletion_requested_at IS NULL");
    expect(String(query.mock.calls[0]?.[0])).toContain("JOIN users owner");
  });
});
