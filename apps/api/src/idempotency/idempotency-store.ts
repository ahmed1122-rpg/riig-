interface IdempotencyEntry {
  resourceId: string;
  requestHash?: string;
  expiresAt: number;
}

export type IdempotencyClaim =
  | { outcome: "claimed"; resourceId: string }
  | { outcome: "replayed"; resourceId: string; legacy: boolean }
  | { outcome: "conflict"; resourceId: string };

export interface IdempotencyStore {
  claim(
    namespace: string,
    key: string,
    resourceId: string,
    ttlSeconds: number,
  ): Promise<string>;
  claimRequest(
    namespace: string,
    key: string,
    resourceId: string,
    requestHash: string,
    ttlSeconds: number,
  ): Promise<IdempotencyClaim>;
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
    const claim = await this.claimInternal(
      namespace,
      key,
      resourceId,
      undefined,
      ttlSeconds,
    );
    return claim.resourceId;
  }

  claimRequest(
    namespace: string,
    key: string,
    resourceId: string,
    requestHash: string,
    ttlSeconds: number,
  ): Promise<IdempotencyClaim> {
    return this.claimInternal(
      namespace,
      key,
      resourceId,
      requestHash,
      ttlSeconds,
    );
  }

  private async claimInternal(
    namespace: string,
    key: string,
    resourceId: string,
    requestHash: string | undefined,
    ttlSeconds: number,
  ): Promise<IdempotencyClaim> {
    const storageKey = `${namespace}:${key}`;
    const existing = this.#entries.get(storageKey);
    if (existing && existing.expiresAt > Date.now()) {
      if (
        requestHash !== undefined &&
        existing.requestHash !== undefined &&
        existing.requestHash !== requestHash
      ) {
        return { outcome: "conflict", resourceId: existing.resourceId };
      }
      return {
        outcome: "replayed",
        resourceId: existing.resourceId,
        legacy: existing.requestHash === undefined,
      };
    }
    this.#entries.set(storageKey, {
      resourceId,
      ...(requestHash === undefined ? {} : { requestHash }),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return { outcome: "claimed", resourceId };
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
