export interface StoredObject {
  key: string;
  contentType: string;
  sizeBytes: number;
  body: Buffer;
}

export interface ObjectStorage {
  put(object: StoredObject): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export class InMemoryObjectStorage implements ObjectStorage {
  readonly #objects = new Map<string, StoredObject>();

  async put(object: StoredObject): Promise<void> {
    this.#objects.set(object.key, {
      ...object,
      body: Buffer.from(object.body),
    });
  }

  async get(key: string): Promise<StoredObject | null> {
    const object = this.#objects.get(key);
    return object ? { ...object, body: Buffer.from(object.body) } : null;
  }

  async delete(key: string): Promise<void> {
    this.#objects.delete(key);
  }
}
