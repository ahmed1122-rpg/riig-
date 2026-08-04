import { describe, expect, it } from "vitest";
import {
  InMemoryObjectStorage,
  type StoredObject,
} from "../storage/object-storage.js";
import { cleanupRasterAssets } from "./raster-asset-cleanup.js";

class SelectiveDeleteFailureStorage extends InMemoryObjectStorage {
  override async delete(objectKey: string): Promise<void> {
    if (objectKey.includes("failure")) {
      throw new Error("delete unavailable");
    }
    await super.delete(objectKey);
  }
}

describe("cleanupRasterAssets", () => {
  it("deletes successful objects and reports failed deletes safely", async () => {
    const storage = new SelectiveDeleteFailureStorage();
    const objects = [storedObject("success"), storedObject("failure")];
    await Promise.all(objects.map((object) => storage.put(object)));
    const reported: string[] = [];

    await expect(
      cleanupRasterAssets(storage, objects.map(({ key }) => key), (_error, key) => {
        reported.push(key);
        throw new Error("observer unavailable");
      }),
    ).resolves.toBeUndefined();

    await expect(storage.inspect("success")).resolves.toBeNull();
    await expect(storage.inspect("failure")).resolves.not.toBeNull();
    expect(reported).toEqual(["failure"]);
  });

  it("keeps cleanup best-effort when no observer is configured", async () => {
    const storage = new SelectiveDeleteFailureStorage();

    await expect(
      cleanupRasterAssets(storage, ["failure"]),
    ).resolves.toBeUndefined();
  });
});

function storedObject(key: string): StoredObject {
  const body = Buffer.from(key);
  return {
    key,
    contentType: "application/octet-stream",
    sizeBytes: body.byteLength,
    body,
  };
}
