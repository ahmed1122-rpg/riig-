import type { PreparedRasterAsset } from "@motionprep/media-processing";
import { describe, expect, it, vi } from "vitest";
import {
  InMemoryObjectStorage,
  type StoredObject,
} from "../storage/object-storage.js";
import {
  writeRasterAssets,
  type RasterAssetWriteObservation,
} from "./raster-asset-writer.js";

class MeasuredStorage extends InMemoryObjectStorage {
  activeWrites = 0;
  maxActiveWrites = 0;
  readonly events: string[] = [];

  constructor(
    private readonly failingKey?: string,
    private readonly delays: Readonly<Record<string, number>> = {},
  ) {
    super();
  }

  override async put(object: StoredObject) {
    this.activeWrites += 1;
    this.maxActiveWrites = Math.max(
      this.maxActiveWrites,
      this.activeWrites,
    );
    this.events.push(`put:start:${object.key}`);
    try {
      await delay(this.delays[object.key] ?? 5);
      if (object.key === this.failingKey) {
        throw new Error(`write failed: ${object.key}`);
      }
      const result = await super.put(object);
      this.events.push(`put:complete:${object.key}`);
      return result;
    } finally {
      this.activeWrites -= 1;
    }
  }

  override async purge(
    objectKeys: readonly string[],
    prefixes: readonly string[],
  ): Promise<void> {
    objectKeys.forEach((objectKey) => this.events.push(`purge:${objectKey}`));
    await super.purge(objectKeys, prefixes);
  }
}

describe("writeRasterAssets", () => {
  it("bounds concurrent writes and reports measured work", async () => {
    const storage = new MeasuredStorage();
    const observations: RasterAssetWriteObservation[] = [];

    await expect(
      writeRasterAssets(storage, assets("one", "two", "three", "four"), {
        concurrency: 2,
        onObservation: (observation) => observations.push(observation),
      }),
    ).resolves.toEqual(["one", "two", "three", "four"]);

    expect(storage.maxActiveWrites).toBe(2);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      assetCount: 4,
      storedCount: 4,
      totalBytes: 15,
      concurrency: 2,
      outcome: "succeeded",
    });
    expect(observations[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("waits for the whole batch before cleaning partial writes", async () => {
    const storage = new MeasuredStorage("failure", {
      failure: 1,
      successful: 15,
    });
    const observations: RasterAssetWriteObservation[] = [];

    await expect(
      writeRasterAssets(storage, assets("failure", "successful"), {
        concurrency: 2,
        onObservation: (observation) => observations.push(observation),
      }),
    ).rejects.toThrow("write failed: failure");

    expect(storage.events.indexOf("put:complete:successful")).toBeLessThan(
      storage.events.indexOf("purge:successful"),
    );
    await expect(storage.inspect("successful")).resolves.toBeNull();
    expect(observations[0]).toMatchObject({
      assetCount: 2,
      storedCount: 1,
      outcome: "failed",
    });
  });

  it("cleans completed batches when the worker loses its lease", async () => {
    const storage = new MeasuredStorage();
    const assertCanContinue = vi
      .fn<() => void>()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error("lease lost");
      });

    await expect(
      writeRasterAssets(storage, assets("one", "two"), {
        concurrency: 2,
        assertCanContinue,
      }),
    ).rejects.toThrow("lease lost");

    await expect(storage.inspect("one")).resolves.toBeNull();
    await expect(storage.inspect("two")).resolves.toBeNull();
  });

  it("does not let an observation failure replace a successful write", async () => {
    const storage = new MeasuredStorage();
    const observationErrors: unknown[] = [];

    await expect(
      writeRasterAssets(storage, assets("one"), {
        onObservation: () => {
          throw new Error("metrics unavailable");
        },
        onObservationError: (error) => observationErrors.push(error),
      }),
    ).resolves.toEqual(["one"]);

    expect(observationErrors).toHaveLength(1);
  });

  it("registers every object before storage and aborts an unregistered write", async () => {
    const storage = new MeasuredStorage();
    const events = storage.events;

    await writeRasterAssets(storage, assets("registered"), {
      beforeStore: async (objectKey) => {
        events.push(`register:${objectKey}`);
      },
    });
    expect(events.indexOf("register:registered")).toBeLessThan(
      events.indexOf("put:start:registered"),
    );

    await expect(
      writeRasterAssets(storage, assets("unregistered"), {
        beforeStore: async () => {
          throw new Error("registry unavailable");
        },
      }),
    ).rejects.toThrow("registry unavailable");
    expect(events).not.toContain("put:start:unregistered");
  });
});

function assets(...keys: string[]): PreparedRasterAsset[] {
  return keys.map((key) => {
    const body = Buffer.from(key);
    return {
      layerId: `layer-${key}`,
      objectKey: key,
      contentType: "image/png",
      sizeBytes: body.byteLength,
      sha256: "0".repeat(64),
      body,
    };
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
