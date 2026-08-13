import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  parseDeclaredContentLength,
  readBoundedUploadBody,
  UploadBodyGate,
  UploadBodyTooLargeError,
} from "./upload-body-parser.js";

describe("upload body parser", () => {
  it("holds twenty readers behind the configured backpressure gate", async () => {
    const gate = new UploadBodyGate(3);
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const operations = Array.from({ length: 20 }, () => gate.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await barrier;
      active -= 1;
    }));

    await new Promise((resolve) => setImmediate(resolve));
    expect(peak).toBe(3);
    release();
    await Promise.all(operations);
  });

  it("rejects declared and streamed overflow with HTTP 413 semantics", async () => {
    await expect(readBoundedUploadBody(Readable.from([]), 30, 31))
      .rejects.toBeInstanceOf(UploadBodyTooLargeError);
    await expect(readBoundedUploadBody(Readable.from([Buffer.alloc(20), Buffer.alloc(11)]), 30))
      .rejects.toMatchObject({ statusCode: 413 });
    expect(parseDeclaredContentLength("30")).toBe(30);
    expect(parseDeclaredContentLength("invalid")).toBeUndefined();
  });

  it("keeps twenty real 30 MiB reads inside the bounded memory window", async () => {
    const mebibyte = 1024 * 1024;
    const limit = 30 * mebibyte;
    const gate = new UploadBodyGate(3);
    const initialRss = process.memoryUsage().rss;
    let peakRss = initialRss;
    let active = 0;
    let peakActive = 0;
    await Promise.all(
      Array.from({ length: 20 }, () => gate.run(async () => {
        active += 1;
        peakActive = Math.max(peakActive, active);
        const body = await readBoundedUploadBody(
          Readable.from(thirtyMiBPayload(mebibyte)),
          limit,
          limit,
        );
        expect(body.byteLength).toBe(limit);
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
        active -= 1;
      })),
    );
    expect(peakActive).toBe(3);
    expect(peakRss - initialRss).toBeLessThan(384 * mebibyte);
  }, 60_000);

  it("rejects an actual 31 MiB stream as HTTP 413", async () => {
    const mebibyte = 1024 * 1024;
    await expect(
      readBoundedUploadBody(
        Readable.from(thirtyMiBPayload(mebibyte, 31)),
        30 * mebibyte,
      ),
    ).rejects.toMatchObject({ statusCode: 413 });
  });
});

async function* thirtyMiBPayload(
  chunkBytes: number,
  chunks = 30,
): AsyncGenerator<Buffer> {
  const chunk = Buffer.alloc(chunkBytes);
  for (let index = 0; index < chunks; index += 1) {
    yield chunk;
    if (index % 4 === 3) await new Promise((resolve) => setImmediate(resolve));
  }
}
