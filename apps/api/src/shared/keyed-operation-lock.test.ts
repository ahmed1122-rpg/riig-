import { describe, expect, it } from "vitest";
import { KeyedOperationLock } from "./keyed-operation-lock.js";

describe("KeyedOperationLock", () => {
  it("serializes the same key without blocking a different key", async () => {
    const lock = new KeyedOperationLock();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = lock.run("same", async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
    });
    const second = lock.run("same", async () => {
      events.push("second");
    });
    const unrelated = lock.run("other", async () => {
      events.push("other");
    });

    await unrelated;
    expect(events).toEqual(["first:start", "other"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "other", "first:end", "second"]);
  });

  it("releases the next waiter after a rejected operation", async () => {
    const lock = new KeyedOperationLock();
    const failure = lock.run("project", async () => {
      throw new Error("failed");
    });
    const next = lock.run("project", async () => "completed");

    await expect(failure).rejects.toThrow("failed");
    await expect(next).resolves.toBe("completed");
  });
});
