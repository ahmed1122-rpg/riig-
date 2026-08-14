import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresObjectWriteLeaseCoordinator } from "./postgres-object-write-lease.js";

describe("PostgresObjectWriteLeaseCoordinator", () => {
  it("serializes acquisition with the owner tombstone lock", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      statements.push(sql);
      if (sql.includes("SELECT owner.id AS owner_user_id")) {
        return { rows: [{ owner_user_id: "user-1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const release = vi.fn();
    const coordinator = new PostgresObjectWriteLeaseCoordinator({
      connect: vi.fn().mockResolvedValue({ query, release } as unknown as PoolClient),
    } as unknown as Pool);

    await coordinator.acquire(
      { projectId: "project-1", writerType: "upload" },
      "sources/project-1/upload.png",
      "2026-08-13T10:00:00.000Z",
      "2026-08-13T10:15:00.000Z",
    );

    expect(statements.join("\n")).toContain("FOR KEY SHARE OF owner");
    expect(statements.findIndex((sql) => sql === "BEGIN")).toBeLessThan(
      statements.findIndex((sql) => sql.includes("INSERT INTO object_write_leases")),
    );
    expect(statements.at(-1)).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("fails closed before storage when the owner is tombstoned", async () => {
    const query = vi.fn(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      return sql.includes("SELECT owner.id AS owner_user_id")
        ? { rows: [], rowCount: 0 }
        : { rows: [], rowCount: 1 };
    });
    const coordinator = new PostgresObjectWriteLeaseCoordinator({
      connect: vi.fn().mockResolvedValue({
        query,
        release: vi.fn(),
      } as unknown as PoolClient),
    } as unknown as Pool);

    await expect(coordinator.acquire(
      { projectId: "project-1", writerType: "export" },
      "artifacts/project-1/export.zip",
      "2026-08-13T10:00:00.000Z",
      "2026-08-13T10:15:00.000Z",
    )).rejects.toThrow(/disabled object writes/u);
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("INSERT INTO object_write_leases"),
    )).toBe(false);
  });
});
