import type { Readable } from "node:stream";

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
    await this.#acquire();
    try {
      return await operation();
    } finally {
      this.#release();
    }
  }

  async #acquire(): Promise<void> {
    if (this.#active < this.concurrency) {
      this.#active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.#waiters.push(resolve));
    this.#active += 1;
  }

  #release(): void {
    this.#active -= 1;
    this.#waiters.shift()?.();
  }
}

export async function readBoundedUploadBody(
  payload: Readable,
  maxBytes: number,
  declaredBytes?: number,
): Promise<Buffer> {
  if (declaredBytes !== undefined && declaredBytes > maxBytes) {
    throw new UploadBodyTooLargeError(maxBytes);
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const value of payload) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    totalBytes += chunk.byteLength;
    if (totalBytes > maxBytes) throw new UploadBodyTooLargeError(maxBytes);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, totalBytes);
}

export function parseDeclaredContentLength(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) ? bytes : undefined;
}
