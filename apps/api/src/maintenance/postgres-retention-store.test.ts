import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresRetentionStore } from "./postgres-retention-store.js";

describe("PostgresRetentionStore privacy fences", () => {
  it("protects ready identity models in list, claim, and finalize", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      statements.push(sql);
      return {
        rows: [],
        rowCount:
          sql.startsWith("UPDATE") || sql.includes("SELECT reference.id FROM")
            ? 1
            : 0,
      };
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = {
      query,
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const store = new PostgresRetentionStore(pool);

    await store.listExpiredCharacterReferences("2026-08-13T10:00:00.000Z", 10);
    await store.claimCharacterReferencePurge(
      { referenceId: "reference-1", objectKey: "projects/p/reference.png" },
      "2026-08-13T10:00:00.000Z",
    );
    await store.markCharacterReferencePurged(
      "reference-1",
      "2026-08-13T10:00:00.000Z",
    );

    const protectedStatements = statements.filter((sql) =>
      sql.includes("character_identity_model_versions"),
    );
    expect(protectedStatements).toHaveLength(3);
    protectedStatements.forEach((sql) => {
      expect(sql).toContain("model.status IN ('draft', 'training', 'ready')");
    });
  });

  it("claims legacy export keys using the same fallback used by listing", async () => {
    let statement = "";
    const query = vi.fn(async (sqlValue: unknown) => {
      statement = String(sqlValue);
      return { rows: [], rowCount: 1 };
    });
    const store = new PostgresRetentionStore({ query } as unknown as Pool);

    await expect(store.claimArtifactPurge(
      {
        exportId: "00000000-0000-4000-8000-000000000001",
        objectKey:
          "artifacts/00000000-0000-4000-8000-000000000002/" +
          "00000000-0000-4000-8000-000000000001/export.zip",
      },
      "2026-08-13T10:00:00.000Z",
    )).resolves.toBe(true);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        "'artifacts/' || project_id::text || '/' || id::text || '/' || (artifact->>'filename')",
      ),
      expect.any(Array),
    );
    expect(statement).toContain(
      "purge_claimed_at = $3::timestamptz",
    );
    expect(statement).toContain(
      "(artifact->>'expiresAt')::timestamptz <= $3::timestamptz",
    );
  });
});
