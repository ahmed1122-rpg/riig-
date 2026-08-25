import { describe, expect, it } from "vitest";
import type {
  OperationalStatusProvider,
  OperationalStatusSnapshot,
} from "./operational-status.js";
import { assertLiveWorker, hasLiveWorker } from "./worker-readiness.js";

const baseSnapshot: OperationalStatusSnapshot = {
  status: "degraded",
  workers: [],
  queues: [],
  emailOutbox: null,
  maintenance: null,
  checkedAt: "2026-08-12T00:00:00.000Z",
};

describe("worker readiness", () => {
  it("requires a fresh heartbeat for the requested worker type", async () => {
    const staleCharacter: OperationalStatusSnapshot = {
      ...baseSnapshot,
      workers: [
        {
          instanceId: "character-1",
          workerType: "character",
          releaseVersion: "sha-test",
          concurrency: 1,
          residentMemoryBytes: 1,
          heapUsedBytes: 1,
          cpuUserSeconds: 0,
          cpuSystemSeconds: 0,
          lastSeenAt: baseSnapshot.checkedAt,
          stale: true,
        },
      ],
    };
    expect(hasLiveWorker(staleCharacter, "character")).toBe(false);
    const provider: OperationalStatusProvider = {
      async snapshot() {
        return staleCharacter;
      },
    };
    await expect(assertLiveWorker(provider, "character")).rejects.toThrow(
      "character worker heartbeat is missing or stale",
    );
  });

  it("accepts a fresh heartbeat of the requested type", async () => {
    const snapshot: OperationalStatusSnapshot = {
      ...baseSnapshot,
      workers: [
        {
          instanceId: "character-1",
          workerType: "character",
          releaseVersion: "sha-test",
          concurrency: 1,
          residentMemoryBytes: 1,
          heapUsedBytes: 1,
          cpuUserSeconds: 0,
          cpuSystemSeconds: 0,
          lastSeenAt: baseSnapshot.checkedAt,
          stale: false,
        },
      ],
    };
    const provider: OperationalStatusProvider = {
      async snapshot() {
        return snapshot;
      },
    };
    await expect(assertLiveWorker(provider, "character")).resolves.toBeUndefined();
  });

  it("rejects a fresh worker from a different release", async () => {
    const snapshot: OperationalStatusSnapshot = {
      ...baseSnapshot,
      workers: [
        {
          instanceId: "security-1",
          workerType: "security",
          releaseVersion: "a".repeat(40),
          concurrency: 1,
          residentMemoryBytes: 1,
          heapUsedBytes: 1,
          cpuUserSeconds: 0,
          cpuSystemSeconds: 0,
          lastSeenAt: baseSnapshot.checkedAt,
          stale: false,
        },
      ],
    };
    const provider: OperationalStatusProvider = {
      async snapshot() {
        return snapshot;
      },
    };

    expect(hasLiveWorker(snapshot, "security", "b".repeat(40))).toBe(false);
    await expect(
      assertLiveWorker(provider, "security", "b".repeat(40)),
    ).rejects.toThrow("does not match release");
    await expect(
      assertLiveWorker(provider, "security", "a".repeat(40)),
    ).resolves.toBeUndefined();
  });

  it("rejects a mixed live fleet even when one worker matches", async () => {
    const expectedRelease = "a".repeat(40);
    const worker = {
      instanceId: "media-1",
      workerType: "media" as const,
      releaseVersion: expectedRelease,
      concurrency: 1,
      residentMemoryBytes: 1,
      heapUsedBytes: 1,
      cpuUserSeconds: 0,
      cpuSystemSeconds: 0,
      lastSeenAt: baseSnapshot.checkedAt,
      stale: false,
    };
    const snapshot: OperationalStatusSnapshot = {
      ...baseSnapshot,
      workers: [
        worker,
        {
          ...worker,
          instanceId: "media-old",
          releaseVersion: "b".repeat(40),
        },
      ],
    };

    expect(hasLiveWorker(snapshot, "media", expectedRelease)).toBe(false);
  });
});
