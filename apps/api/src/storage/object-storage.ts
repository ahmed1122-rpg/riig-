import { createHash } from "node:crypto";

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

export interface ObjectStorage {
  put(object: StoredObject): Promise<StoredObjectMetadata>;
  inspect(key: string): Promise<StoredObjectMetadata | null>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export class InMemoryObjectStorage implements ObjectStorage {
  readonly #objects = new Map<string, StoredObject>();

  async put(object: StoredObject): Promise<StoredObjectMetadata> {
    this.#objects.set(object.key, {
      ...object,
      body: Buffer.from(object.body),
    });
    return metadataFor(object);
  }

  async inspect(key: string): Promise<StoredObjectMetadata | null> {
    const object = this.#objects.get(key);
    return object ? metadataFor(object) : null;
  }

  async get(key: string): Promise<StoredObject | null> {
    const object = this.#objects.get(key);
    return object ? { ...object, body: Buffer.from(object.body) } : null;
  }

  async delete(key: string): Promise<void> {
    this.#objects.delete(key);
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
