import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createRedisSecurityWithClient } from "./redis-login-attempt-store.js";

function createClient() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    isOpen: true,
    isReady: true,
    connect: vi.fn(async () => undefined),
    ping: vi.fn(async () => "PONG"),
    close: vi.fn(async () => undefined),
    exists: vi.fn(async () => 0),
    sendCommand: vi.fn(async () => [1, 1_000]),
    del: vi.fn(async () => 0),
  });
}

const options = {
  maxFailures: 5,
  windowSeconds: 900,
  lockSeconds: 300,
};

describe("Redis security lifecycle", () => {
  it("handles client errors without turning them into unhandled events", () => {
    const client = createClient();
    const onError = vi.fn();
    createRedisSecurityWithClient(client, { ...options, onError });
    const error = Object.assign(new Error("socket closed"), {
      code: "ECONNRESET",
    });

    expect(() => client.emit("error", error)).not.toThrow();
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("fails readiness while reconnecting and recovers when ready", async () => {
    const client = createClient();
    const security = createRedisSecurityWithClient(client, options);
    client.isReady = false;

    await expect(security.ready()).rejects.toThrow(/reconnecting/u);
    expect(client.ping).not.toHaveBeenCalled();

    client.isReady = true;
    await expect(security.ready()).resolves.toBeUndefined();
    expect(client.ping).toHaveBeenCalledOnce();
  });

  it("opens a closed client before probing and closes an open client", async () => {
    const client = createClient();
    client.isOpen = false;
    const security = createRedisSecurityWithClient(client, options);
    client.connect.mockImplementationOnce(async () => {
      client.isOpen = true;
    });

    await security.ready();
    await security.close();

    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalledOnce();
  });
});
