import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  createVerifiedObjectStream,
  InMemoryObjectStorage,
  ObjectStorageIntegrityError,
  ObjectStorageReadAbortedError,
  ObjectStorageReadLimitError,
} from "./object-storage.js";

describe("ObjectStorage streaming contract", () => {
  it("rejects a write whose declared size differs from its bytes", async () => {
    const storage = new InMemoryObjectStorage();

    await expect(
      storage.put({
        key: "sources/project/inconsistent.bin",
        contentType: "application/octet-stream",
        sizeBytes: 99,
        body: Buffer.from("short"),
      }),
    ).rejects.toBeInstanceOf(ObjectStorageIntegrityError);
    await expect(
      storage.inspect("sources/project/inconsistent.bin"),
    ).resolves.toBeNull();
  });

  it("bounds buffered compatibility reads by metadata", async () => {
    const storage = new InMemoryObjectStorage();
    const body = Buffer.from("bounded");
    await storage.put({
      key: "sources/project/bounded.bin",
      contentType: "application/octet-stream",
      sizeBytes: body.byteLength,
      body,
    });

    await expect(
      storage.get("sources/project/bounded.bin", { maxBytes: body.length - 1 }),
    ).rejects.toBeInstanceOf(ObjectStorageReadLimitError);
    await expect(
      storage.get("sources/project/bounded.bin", { maxBytes: body.length }),
    ).resolves.toMatchObject({ body });
  });

  it("propagates cancellation to an object stream", async () => {
    const storage = new InMemoryObjectStorage();
    const body = Buffer.alloc(64 * 1024, 7);
    await storage.put({
      key: "artifacts/project/cancel.bin",
      contentType: "application/octet-stream",
      sizeBytes: body.byteLength,
      body,
    });
    const controller = new AbortController();
    controller.abort();
    const object = await storage.getStream("artifacts/project/cancel.bin", {
      signal: controller.signal,
    });

    await expect(async () => {
      for await (const _chunk of object!.body) {
        // The pre-aborted signal must fail before a complete delivery.
      }
    }).rejects.toBeInstanceOf(ObjectStorageReadAbortedError);
  });

  it("checks the byte count and digest at the end of a streamed transfer", async () => {
    const stream = createVerifiedObjectStream(
      Readable.from([Buffer.from("wrong")]),
      {
        key: "artifacts/project/integrity.bin",
        contentType: "application/octet-stream",
        sizeBytes: 5,
        sha256: "0".repeat(64),
      },
    );

    await expect(async () => {
      for await (const _chunk of stream) {
        // The verifier reports the mismatch only after the final chunk.
      }
    }).rejects.toBeInstanceOf(ObjectStorageIntegrityError);
  });

  it("purges exact keys and owned prefixes without touching siblings", async () => {
    const storage = new InMemoryObjectStorage();
    for (const key of ["private/foo", "private/foobar", "owned/a", "other/a"]) {
      await storage.put({
        key,
        contentType: "application/octet-stream",
        sizeBytes: 1,
        body: Buffer.from([1]),
      });
    }

    await storage.purge(["private/foo"], ["owned/"]);

    await expect(storage.list("")).resolves.toEqual(["other/a", "private/foobar"]);
  });
});
