import { describe, expect, it, vi } from "vitest";
import type { ObjectStorage } from "../storage/object-storage.js";
import type { CharacterInferenceProvider } from "./character-inference-provider.js";
import type { CharacterJobRepository } from "./character-job-repository.js";
import type { CharacterJobResultCommitter } from "./character-job-result-committer.js";
import type { CharacterRigRepository } from "./character-rig-repository.js";
import { runCharacterWorkerLoop } from "./character-worker-loop.js";

describe("runCharacterWorkerLoop", () => {
  it("isolates a transient claim failure and continues polling", async () => {
    const controller = new AbortController();
    const claimNext = vi.fn(async () => {
      if (claimNext.mock.calls.length === 1) {
        throw new Error("database temporarily unavailable");
      }
      controller.abort();
      return null;
    });
    const onLoopError = vi.fn();

    await runCharacterWorkerLoop({
      jobs: { claimNext } as unknown as CharacterJobRepository,
      characterRigs: {} as CharacterRigRepository,
      resultCommitter: {} as CharacterJobResultCommitter,
      provider: {} as CharacterInferenceProvider,
      storage: {} as ObjectStorage,
      workerId: "character-loop-1",
      leaseMilliseconds: 60_000,
      pollMilliseconds: 10,
      signal: controller.signal,
      delay: async () => undefined,
      onLoopError,
    });

    expect(claimNext).toHaveBeenCalledTimes(2);
    expect(onLoopError).toHaveBeenCalledOnce();
    expect(onLoopError.mock.calls[0]?.[0]).toMatchObject({
      message: "database temporarily unavailable",
    });
  });
});
