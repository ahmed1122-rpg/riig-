import { EventEmitter } from "node:events";
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createDatabase } from "./database.js";

describe("database pool lifecycle", () => {
  it("handles idle-client errors without an unhandled error event", async () => {
    const onError = vi.fn();
    const database = createDatabase(
      "postgresql://motionprep:motionprep@127.0.0.1:1/motionprep",
      1,
      { applicationName: "test-worker", onError },
    );
    const error = Object.assign(new Error("connection terminated"), {
      code: "57P01",
    });

    expect(() =>
      database.pool.emit("error", error, {} as PoolClient),
    ).not.toThrow();
    expect(onError).toHaveBeenCalledWith(error);

    await database.close();
  });

  it("guards checked-out clients during a database restart", async () => {
    const onError = vi.fn();
    const database = createDatabase(
      "postgresql://motionprep:motionprep@127.0.0.1:1/motionprep",
      1,
      { applicationName: "test-worker", onError },
    );
    const client = new EventEmitter() as PoolClient;
    const error = Object.assign(new Error("database restart"), {
      code: "57P01",
    });

    database.pool.emit("acquire", client);
    expect(client.listenerCount("error")).toBe(1);
    expect(() => client.emit("error", error)).not.toThrow();
    expect(onError).toHaveBeenCalledWith(error);

    database.pool.emit("release", undefined as never, client);
    expect(client.listenerCount("error")).toBe(0);
    await database.close();
  });
});
