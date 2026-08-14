import type { LayerDocument } from "@motionprep/contracts";
import { describe, expect, it, vi } from "vitest";
import { InMemoryObjectStorage } from "../storage/object-storage.js";
import type { DerivedAssetRegistry } from "../storage/derived-asset-registry.js";
import { RasterAssetStore } from "./raster-asset-store.js";

const document: LayerDocument = {
  schemaVersion: "1.0",
  projectId: "project-1",
  sourceVersionId: "source-1",
  revision: 1,
  width: 1,
  height: 1,
  colorSpace: "sRGB",
  layers: [],
};

describe("RasterAssetStore derived lifecycle", () => {
  it("gives repeated tool operations unique registered object keys", async () => {
    const storage = new InMemoryObjectStorage();
    const register = vi.fn().mockResolvedValue(undefined);
    const store = new RasterAssetStore(storage, { register });

    const first = await store.storeTool(
      document,
      2,
      "edge-refine",
      "layer-1",
      "operation-1",
      Buffer.from([1]),
    );
    const second = await store.storeTool(
      document,
      2,
      "edge-refine",
      "layer-1",
      "operation-2",
      Buffer.from([2]),
    );

    expect(first.objectKey).not.toBe(second.objectKey);
    expect(register).toHaveBeenNthCalledWith(
      1,
      "project-1",
      first.objectKey,
      "tool",
    );
    expect(register).toHaveBeenNthCalledWith(
      2,
      "project-1",
      second.objectKey,
      "tool",
    );
    await expect(storage.get(first.objectKey)).resolves.not.toBeNull();
    await expect(storage.get(second.objectKey)).resolves.not.toBeNull();
  });

  it("fails closed before object storage when ownership cannot be registered", async () => {
    const storage = new InMemoryObjectStorage();
    const registry: DerivedAssetRegistry = {
      register: vi.fn().mockRejectedValue(new Error("registry unavailable")),
    };
    const store = new RasterAssetStore(storage, registry);
    const expectedKey =
      "derived/project-1/source-1/guidance/revision-2/layer-1-refined-operation-1.png";

    await expect(
      store.storeGuided(
        document,
        2,
        "layer-1",
        "refined",
        "operation-1",
        Buffer.from([1]),
      ),
    ).rejects.toThrow("registry unavailable");
    await expect(storage.get(expectedKey)).resolves.toBeNull();
  });
});
