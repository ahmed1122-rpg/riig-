import { describe, expect, it, vi } from "vitest";
import { PostgresLayerDocumentRepository } from "./postgres-layer-document-repository.js";

function layerDocument() {
  return {
    schemaVersion: "1.0" as const,
    projectId: "00000000-0000-4000-8000-000000000001",
    sourceVersionId: "00000000-0000-4000-8000-000000000002",
    revision: 2,
    width: 100,
    height: 100,
    colorSpace: "sRGB" as const,
    layers: [],
  };
}

function staleSourcePool() {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT current_source_version_id")) {
      return {
        rows: [{
          current_source_version_id:
            "00000000-0000-4000-8000-000000000099",
        }],
      };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  return {
    pool: { connect: vi.fn().mockResolvedValue({ query, release }) },
    query,
    release,
  };
}

describe("PostgresLayerDocumentRepository source guard", () => {
  it("returns a revision conflict before a stale source can update JSONB", async () => {
    const fixture = staleSourcePool();
    const repository = new PostgresLayerDocumentRepository(fixture.pool as never);
    await expect(repository.saveIfRevision(layerDocument(), 1)).resolves.toBe(false);
    expect(fixture.query.mock.calls.map(([sql]) => String(sql))).toEqual([
      "BEGIN",
      expect.stringContaining("SELECT current_source_version_id"),
      "ROLLBACK",
    ]);
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it("rolls back an initial worker save when its source is no longer current", async () => {
    const fixture = staleSourcePool();
    const repository = new PostgresLayerDocumentRepository(fixture.pool as never);
    await expect(repository.save(layerDocument())).rejects.toThrow(/no longer current/u);
    expect(fixture.query.mock.calls.map(([sql]) => String(sql))).toEqual([
      "BEGIN",
      expect.stringContaining("SELECT current_source_version_id"),
      "ROLLBACK",
    ]);
    expect(fixture.release).toHaveBeenCalledOnce();
  });
});
