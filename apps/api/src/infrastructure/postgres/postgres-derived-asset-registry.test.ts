import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresDerivedAssetRegistry } from "./postgres-derived-asset-registry.js";

describe("PostgresDerivedAssetRegistry", () => {
  it("revives and re-owns a derived key before object storage writes", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const registry = new PostgresDerivedAssetRegistry({ query } as unknown as Pool);

    await registry.register(
      "project-1",
      "derived/project-1/source/revision-1/layer.png",
      "processing",
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("purged_at = NULL"),
      [
        "project-1",
        "derived/project-1/source/revision-1/layer.png",
        "processing",
      ],
    );
  });

  it("fails closed when the owning project no longer exists", async () => {
    const registry = new PostgresDerivedAssetRegistry({
      query: vi.fn().mockResolvedValue({ rowCount: 0 }),
    } as unknown as Pool);

    await expect(
      registry.register("missing", "derived/missing/layer.png", "tool"),
    ).rejects.toThrow("project does not exist");
  });
});
