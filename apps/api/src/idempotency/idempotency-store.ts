interface IdempotencyEntry {
  resourceId: string;
  expiresAt: number;
}

export interface IdempotencyStore {
  claim(
    namespace: string,
    key: string,
    resourceId: string,
    ttlSeconds: number,
  ): Promise<string>;
  release(
    namespace: string,
    key: string,
    resourceId: string,
  ): Promise<void>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly #entries = new Map<string, IdempotencyEntry>();

  async claim(
    namespace: string,
    key: string,
    resourceId: string,
    ttlSeconds: number,
  ): Promise<string> {
    const storageKey = `${namespace}:${key}`;
    const existing = this.#entries.get(storageKey);
    if (existing && existing.expiresAt > Date.now()) {
      return existing.resourceId;
    }
    this.#entries.set(storageKey, {
      resourceId,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return resourceId;
  }

  async release(
    namespace: string,
    key: string,
    resourceId: string,
  ): Promise<void> {
    const storageKey = `${namespace}:${key}`;
    if (this.#entries.get(storageKey)?.resourceId === resourceId) {
      this.#entries.delete(storageKey);
    }
  }
}

