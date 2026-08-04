import { describe, expect, it } from "vitest";
import { InMemoryIdempotencyStore } from "./idempotency-store.js";

describe("in-memory idempotency store", () => {
  it("distinguishes a safe replay from a conflicting request", async () => {
    const store = new InMemoryIdempotencyStore();
    await expect(
      store.claimRequest("export", "key", "first", "a".repeat(64), 60),
    ).resolves.toEqual({ outcome: "claimed", resourceId: "first" });
    await expect(
      store.claimRequest("export", "key", "second", "a".repeat(64), 60),
    ).resolves.toEqual({
      outcome: "replayed",
      resourceId: "first",
      legacy: false,
    });
    await expect(
      store.claimRequest("export", "key", "third", "b".repeat(64), 60),
    ).resolves.toEqual({ outcome: "conflict", resourceId: "first" });
  });

  it("keeps legacy claims replayable during a rolling deployment", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.claim("upload", "legacy", "old", 60);
    await expect(
      store.claimRequest("upload", "legacy", "new", "c".repeat(64), 60),
    ).resolves.toEqual({
      outcome: "replayed",
      resourceId: "old",
      legacy: true,
    });
  });

  it("releases only the resource that owns the claim", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.claimRequest("export", "key", "first", "a".repeat(64), 60);
    await store.release("export", "key", "other");
    expect(
      await store.claimRequest("export", "key", "second", "a".repeat(64), 60),
    ).toMatchObject({ outcome: "replayed", resourceId: "first" });
    await store.release("export", "key", "first");
    expect(
      await store.claimRequest("export", "key", "second", "a".repeat(64), 60),
    ).toMatchObject({ outcome: "claimed", resourceId: "second" });
  });
});
