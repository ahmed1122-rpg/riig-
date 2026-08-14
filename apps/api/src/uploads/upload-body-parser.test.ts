import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  parseDeclaredContentLength,
  stageBoundedUploadBody,
  UploadBodyGate,
  UploadBodyTooLargeError,
} from "./upload-body-parser.js";

describe("upload body parser", () => {
  it("stages a typed upload and removes the temporary payload on disposal", async () => {
    const pdf = Buffer.from("%PDF-1.7\nstreamed");
    const body = await stageBoundedUploadBody(
      Readable.from([pdf.subarray(0, 4), pdf.subarray(4)]),
      1024,
      pdf.byteLength,
    );

    expect(body).toMatchObject({
      detectedContentType: "application/pdf",
      sizeBytes: pdf.byteLength,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of body.openStream()) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(pdf);

    await body.dispose();
    expect(() => body.openStream()).toThrow(/disposed/u);
  });

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
    await expect(stageBoundedUploadBody(Readable.from([]), 30, 31))
      .rejects.toBeInstanceOf(UploadBodyTooLargeError);
    await expect(stageBoundedUploadBody(Readable.from([Buffer.alloc(20), Buffer.alloc(11)]), 30))
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
        const body = await stageBoundedUploadBody(
          Readable.from(thirtyMiBPayload(mebibyte)),
          limit,
          limit,
        );
        try {
          expect(body.sizeBytes).toBe(limit);
          expect(body.sha256).toMatch(/^[a-f0-9]{64}$/u);
          peakRss = Math.max(peakRss, process.memoryUsage().rss);
        } finally {
          await body.dispose();
          active -= 1;
        }
      })),
    );
    expect(peakActive).toBe(3);
    expect(peakRss - initialRss).toBeLessThan(160 * mebibyte);
  }, 60_000);

  it("rejects an actual 31 MiB stream as HTTP 413", async () => {
    const mebibyte = 1024 * 1024;
    await expect(
      stageBoundedUploadBody(
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
