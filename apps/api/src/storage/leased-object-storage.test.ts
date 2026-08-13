import { describe, expect, it, vi } from "vitest";
import { InMemoryObjectStorage } from "./object-storage.js";
import {
  guardExternalObjectWrite,
  LeaseGuardedObjectStorage,
  objectWriteScope,
  ObjectWriteLeaseLostError,
  type ObjectWriteLease,
  type ObjectWriteLeaseCoordinator,
} from "./leased-object-storage.js";

const projectId = "00000000-0000-4000-8000-000000000001";

function coordinator(options: { acquireFails?: boolean; cooldown?: boolean } = {}) {
  const lease: ObjectWriteLease = {
    id: "00000000-0000-4000-8000-000000000002",
    projectId,
    objectKey: `sources/${projectId}/upload.png`,
  };
  const value: ObjectWriteLeaseCoordinator = {
    acquire: vi.fn(async (_scope, objectKey) => {
      if (options.acquireFails) throw new Error("tombstoned");
      return { ...lease, objectKey };
    }),
    renew: vi.fn(async () => true),
    cooldown: vi.fn(async () => options.cooldown ?? true),
  };
  return value;
}

describe("LeaseGuardedObjectStorage", () => {
  it("derives a strict project and writer scope from every production namespace", () => {
    expect(objectWriteScope(`sources/${projectId}/one`)).toEqual({
      projectId,
      writerType: "upload",
    });
    expect(objectWriteScope(`artifacts/${projectId}/one`)).toEqual({
      projectId,
      writerType: "export",
    });
    expect(objectWriteScope(`projects/${projectId}/one`)).toEqual({
      projectId,
      writerType: "character",
    });
    expect(objectWriteScope(`derived/${projectId}/one`)).toEqual({
      projectId,
      writerType: "derived",
    });
    expect(() => objectWriteScope(`unknown/${projectId}/key`)).toThrow(
      /unsupported write scope/u,
    );
  });

  it("acquires before put and leaves a fifteen-minute publication cooldown", async () => {
    const raw = new InMemoryObjectStorage();
    const leases = coordinator();
    const now = new Date("2026-08-13T10:00:00.000Z");
    const storage = new LeaseGuardedObjectStorage(raw, leases, () => now);
    const key = `sources/${projectId}/upload.png`;

    await storage.put({
      key,
      contentType: "image/png",
      sizeBytes: 1,
      body: Buffer.from([1]),
    });

    expect(leases.acquire).toHaveBeenCalledOnce();
    expect(leases.cooldown).toHaveBeenCalledWith(
      expect.objectContaining({ objectKey: key }),
      "2026-08-13T10:00:00.000Z",
      "2026-08-13T10:15:00.000Z",
    );
    await expect(raw.inspect(key)).resolves.toBeTruthy();
  });

  it("permanently removes bytes when acquisition or cooldown loses the fence", async () => {
    const key = `sources/${projectId}/upload.png`;
    for (const options of [
      { acquireFails: true },
      { cooldown: false },
    ]) {
      const raw = new InMemoryObjectStorage();
      await raw.put({
        key,
        contentType: "image/png",
        sizeBytes: 1,
        body: Buffer.from([1]),
      });
      const storage = new LeaseGuardedObjectStorage(raw, coordinator(options));
      await expect(storage.put({
        key,
        contentType: "image/png",
        sizeBytes: 1,
        body: Buffer.from([2]),
      })).rejects.toBeInstanceOf(
        options.acquireFails ? Error : ObjectWriteLeaseLostError,
      );
      await expect(raw.inspect(key)).resolves.toBeNull();
    }
  });

  it("purges an ambiguous object when the provider reports a failed put", async () => {
    const key = `sources/${projectId}/upload.png`;
    const raw = new InMemoryObjectStorage();
    const originalPut = raw.put.bind(raw);
    raw.put = vi.fn(async (object) => {
      await originalPut(object);
      throw new Error("connection reset after acceptance");
    });
    const purge = vi.spyOn(raw, "purge");
    const storage = new LeaseGuardedObjectStorage(raw, coordinator());

    await expect(storage.put({
      key,
      contentType: "image/png",
      sizeBytes: 1,
      body: Buffer.from([1]),
    })).rejects.toThrow(/connection reset/u);

    expect(purge).toHaveBeenCalledWith([key], []);
    await expect(raw.inspect(key)).resolves.toBeNull();
  });

  it("guards provider-side writes and purges an unpublished external object", async () => {
    const raw = new InMemoryObjectStorage();
    const key = `projects/${projectId}/character-rig/generations/one.png`;
    const storage = new LeaseGuardedObjectStorage(
      raw,
      coordinator({ cooldown: false }),
    );

    await expect(guardExternalObjectWrite(storage, key, async () => {
      await raw.put({
        key,
        contentType: "image/png",
        sizeBytes: 1,
        body: Buffer.from([1]),
      });
      return key;
    })).rejects.toBeInstanceOf(ObjectWriteLeaseLostError);
    await expect(raw.inspect(key)).resolves.toBeNull();
  });
});
