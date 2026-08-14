import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { detectSourceType } from "./source-inspection.js";
import type { PreparedUploadContent } from "./upload-content.js";

export class UploadBodyTooLargeError extends Error {
  readonly statusCode = 413;
  readonly code = "FST_ERR_CTP_BODY_TOO_LARGE";

  constructor(maxBytes: number) {
    super(`Upload body exceeds the ${maxBytes}-byte limit.`);
  }
}

export class UploadBodyGate {
  #active = 0;
  readonly #waiters: Array<() => void> = [];

  constructor(readonly concurrency: number) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) {
      throw new RangeError("Upload body concurrency must be an integer from 1 to 8.");
    }
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async acquire(): Promise<() => void> {
    if (this.#active < this.concurrency) {
      this.#active += 1;
    } else {
      await new Promise<void>((resolve) => this.#waiters.push(resolve));
      this.#active += 1;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#release();
    };
  }

  #release(): void {
    this.#active -= 1;
    this.#waiters.shift()?.();
  }
}

export async function stageBoundedUploadBody(
  payload: Readable,
  maxBytes: number,
  declaredBytes?: number,
  release?: () => void,
): Promise<StagedUploadBody> {
  if (declaredBytes !== undefined && declaredBytes > maxBytes) {
    throw new UploadBodyTooLargeError(maxBytes);
  }
  const directory = await mkdtemp(join(tmpdir(), "motionprep-upload-"));
  const path = join(directory, "payload");
  const hash = createHash("sha256");
  const signatureChunks: Buffer[] = [];
  let signatureBytes = 0;
  let totalBytes = 0;
  const inspector = new Transform({
    transform(value: Buffer, _encoding, callback) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        callback(new UploadBodyTooLargeError(maxBytes));
        return;
      }
      hash.update(chunk);
      if (signatureBytes < 64) {
        const prefix = chunk.subarray(0, Math.min(chunk.byteLength, 64 - signatureBytes));
        signatureChunks.push(Buffer.from(prefix));
        signatureBytes += prefix.byteLength;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(payload, inspector, createWriteStream(path, { flags: "wx" }));
    const signature = Buffer.concat(signatureChunks, signatureBytes);
    return new StagedUploadBody(
      directory,
      path,
      totalBytes,
      hash.digest("hex"),
      detectSourceType(signature),
      release,
    );
  } catch (error) {
    release?.();
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
}

export class StagedUploadBody implements PreparedUploadContent {
  #disposed = false;

  constructor(
    private readonly directory: string,
    private readonly path: string,
    readonly sizeBytes: number,
    readonly sha256: string,
    readonly detectedContentType: PreparedUploadContent["detectedContentType"],
    private readonly release?: () => void,
  ) {}

  openStream(): Readable {
    if (this.#disposed) throw new Error("The staged upload has already been disposed.");
    return createReadStream(this.path);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      await rm(this.directory, { force: true, recursive: true });
    } finally {
      this.release?.();
    }
  }
}

export function parseDeclaredContentLength(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) ? bytes : undefined;
}
