import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";

const DEFAULT_MAX_COLLECT_BYTES = 128 * 1024 * 1024;

export interface StoredObject {
  key: string;
  contentType: string;
  sizeBytes: number;
  body: Buffer;
}

export interface StoredObjectMetadata {
  key: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
}

export interface StoredObjectStream extends StoredObjectMetadata {
  body: Readable;
}

export interface StoredObjectWriteStream extends StoredObjectMetadata {
  body: Readable;
}

export interface ObjectReadOptions {
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface ObjectStorage {
  put(object: StoredObject): Promise<StoredObjectMetadata>;
  putStream(object: StoredObjectWriteStream): Promise<StoredObjectMetadata>;
  list(prefix: string): Promise<string[]>;
  purge(keys: readonly string[], prefixes: readonly string[]): Promise<void>;
  inspect(key: string): Promise<StoredObjectMetadata | null>;
  getStream(
    key: string,
    options?: ObjectReadOptions,
  ): Promise<StoredObjectStream | null>;
  get(key: string, options?: ObjectReadOptions): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export class InMemoryObjectStorage implements ObjectStorage {
  readonly #objects = new Map<string, StoredObject>();

  async put(object: StoredObject): Promise<StoredObjectMetadata> {
    assertWritableSize(object);
    this.#objects.set(object.key, {
      ...object,
      body: Buffer.from(object.body),
    });
    return metadataFor(object);
  }

  async putStream(
    object: StoredObjectWriteStream,
  ): Promise<StoredObjectMetadata> {
    const chunks: Buffer[] = [];
    const hash = createHash("sha256");
    let sizeBytes = 0;
    for await (const value of object.body) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      sizeBytes += chunk.byteLength;
      if (sizeBytes > object.sizeBytes) {
        object.body.destroy();
        throw new ObjectStorageIntegrityError(object.key);
      }
      hash.update(chunk);
      chunks.push(chunk);
    }
    if (sizeBytes !== object.sizeBytes || hash.digest("hex") !== object.sha256) {
      throw new ObjectStorageIntegrityError(object.key);
    }
    const stored = {
      key: object.key,
      contentType: object.contentType,
      sizeBytes,
      body: Buffer.concat(chunks, sizeBytes),
    };
    this.#objects.set(object.key, stored);
    return metadataFor(stored);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.#objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort((left, right) => left.localeCompare(right));
  }

  async purge(keys: readonly string[], prefixes: readonly string[]): Promise<void> {
    const exact = new Set(keys);
    for (const key of this.#objects.keys()) {
      if (exact.has(key) || prefixes.some((prefix) => key.startsWith(prefix))) {
        this.#objects.delete(key);
      }
    }
  }

  async inspect(key: string): Promise<StoredObjectMetadata | null> {
    const object = this.#objects.get(key);
    return object ? metadataFor(object) : null;
  }

  async getStream(
    key: string,
    options: ObjectReadOptions = {},
  ): Promise<StoredObjectStream | null> {
    const object = this.#objects.get(key);
    if (!object) return null;
    const metadata = metadataFor(object);
    assertReadableSize(metadata, options.maxBytes);
    const source = Readable.from([Buffer.from(object.body)]);
    return {
      ...metadata,
      body: createVerifiedObjectStream(source, metadata, options.signal),
    };
  }

  async get(
    key: string,
    options: ObjectReadOptions = {},
  ): Promise<StoredObject | null> {
    return collectStoredObject(await this.getStream(key, options), options);
  }

  async delete(key: string): Promise<void> {
    this.#objects.delete(key);
  }
}

export class ObjectStorageIntegrityError extends Error {
  readonly code = "OBJECT_STORAGE_INTEGRITY_FAILED";

  constructor(key: string) {
    super(`Object storage did not preserve the expected bytes for ${key}.`);
  }
}

export class ObjectStorageReadLimitError extends Error {
  readonly code = "OBJECT_STORAGE_READ_LIMIT_EXCEEDED";

  constructor(
    key: string,
    readonly sizeBytes: number,
    readonly maxBytes: number,
  ) {
    super(`Object ${key} is ${sizeBytes} bytes and exceeds the ${maxBytes}-byte read limit.`);
  }
}

export class ObjectStorageReadAbortedError extends Error {
  readonly code = "OBJECT_STORAGE_READ_ABORTED";

  constructor(key: string) {
    super(`Reading object ${key} was aborted.`);
    this.name = "AbortError";
  }
}

export function isObjectStorageIntegrityFailure(
  error: unknown,
): error is ObjectStorageIntegrityError | ObjectStorageReadLimitError {
  return (
    error instanceof ObjectStorageIntegrityError ||
    error instanceof ObjectStorageReadLimitError
  );
}

export async function collectStoredObject(
  object: StoredObjectStream | null,
  options: ObjectReadOptions = {},
): Promise<StoredObject | null> {
  if (!object) return null;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_COLLECT_BYTES;
  assertReadableSize(object, maxBytes);
  const chunks: Buffer[] = [];
  let sizeBytes = 0;
  try {
    for await (const chunk of object.body) {
      if (options.signal?.aborted) {
        throw new ObjectStorageReadAbortedError(object.key);
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += buffer.byteLength;
      if (sizeBytes > maxBytes) {
        throw new ObjectStorageReadLimitError(object.key, sizeBytes, maxBytes);
      }
      chunks.push(buffer);
    }
  } catch (error) {
    object.body.destroy();
    throw error;
  }
  return {
    key: object.key,
    contentType: object.contentType,
    sizeBytes,
    body: Buffer.concat(chunks, sizeBytes),
  };
}

export function createVerifiedObjectStream(
  source: Readable,
  metadata: StoredObjectMetadata,
  signal?: AbortSignal,
): Readable {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const verifier = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += buffer.byteLength;
      hash.update(buffer);
      callback(null, buffer);
    },
    flush(callback) {
      const sha256 = hash.digest("hex");
      callback(
        sizeBytes === metadata.sizeBytes && sha256 === metadata.sha256
          ? undefined
          : new ObjectStorageIntegrityError(metadata.key),
      );
    },
  });
  const abort = () => {
    const error = new ObjectStorageReadAbortedError(metadata.key);
    source.destroy(error);
    verifier.destroy(error);
  };
  const cleanup = () => signal?.removeEventListener("abort", abort);
  if (signal?.aborted) {
    queueMicrotask(abort);
  } else {
    signal?.addEventListener("abort", abort, { once: true });
  }
  source.once("error", (error) => verifier.destroy(error));
  verifier.once("close", cleanup);
  return source.pipe(verifier);
}

function assertReadableSize(
  metadata: StoredObjectMetadata,
  maxBytes: number | undefined,
): void {
  if (maxBytes !== undefined && metadata.sizeBytes > maxBytes) {
    throw new ObjectStorageReadLimitError(
      metadata.key,
      metadata.sizeBytes,
      maxBytes,
    );
  }
}

export function assertWritableSize(object: StoredObject): void {
  if (object.sizeBytes !== object.body.byteLength) {
    throw new ObjectStorageIntegrityError(object.key);
  }
}

function metadataFor(object: StoredObject): StoredObjectMetadata {
  return {
    key: object.key,
    contentType: object.contentType,
    sizeBytes: object.sizeBytes,
    sha256: createHash("sha256").update(object.body).digest("hex"),
  };
}
