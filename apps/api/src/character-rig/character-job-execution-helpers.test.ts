import type { CharacterJob } from "@motionprep/contracts";
import { describe, expect, it, vi } from "vitest";
import type { CharacterJobExecutionContext } from "./character-job-execution-context.js";
import type { CharacterJobResult } from "./character-job-result-committer.js";
import {
  characterJobErrorCode,
  cleanupResultArtifacts,
  isRetryableCharacterJobError,
  optionalPayloadId,
  removeFailedArtifact,
  requiredPayloadId,
  requiredPayloadNumber,
  retryDelayMilliseconds,
  throwIfCharacterJobAborted,
} from "./character-job-execution-helpers.js";

describe("character job execution helpers", () => {
  it("validates string and positive integer payload values", () => {
    const job = payloadJob({ id: "rig-1", width: 12, empty: "", zero: 0 });
    expect(optionalPayloadId(job, "id")).toBe("rig-1");
    expect(optionalPayloadId(job, "empty")).toBeNull();
    expect(optionalPayloadId(job, "width")).toBeNull();
    expect(requiredPayloadId(job, "id")).toBe("rig-1");
    expectErrorCode(
      () => requiredPayloadId(job, "missing"),
      "CHARACTER_JOB_PAYLOAD_INVALID",
    );
    expect(requiredPayloadNumber(job, "width")).toBe(12);
    for (const key of ["id", "missing", "zero"] as const) {
      expectErrorCode(
        () => requiredPayloadNumber(job, key),
        "CHARACTER_JOB_PAYLOAD_INVALID",
      );
    }
    expectErrorCode(
      () => requiredPayloadNumber(payloadJob({ value: 1.5 }), "value"),
      "CHARACTER_JOB_PAYLOAD_INVALID",
    );
  });

  it("normalizes trusted worker error codes and retry policy", () => {
    expect(characterJobErrorCode({ code: "CHARACTER_SOURCE_NOT_FOUND" }))
      .toBe("CHARACTER_SOURCE_NOT_FOUND");
    expect(characterJobErrorCode({ code: "RASTER_DECODE_FAILED" }))
      .toBe("RASTER_DECODE_FAILED");
    for (const error of [null, "error", {}, { code: 12 }, { code: "OTHER" }]) {
      expect(characterJobErrorCode(error)).toBe("CHARACTER_WORKER_FAILED");
    }
    expect(isRetryableCharacterJobError("CHARACTER_WORKER_FAILED")).toBe(true);
    expect(isRetryableCharacterJobError("CHARACTER_SOURCE_NOT_FOUND")).toBe(false);
    expect(retryDelayMilliseconds(-2)).toBe(1_000);
    expect(retryDelayMilliseconds(3)).toBe(4_000);
    expect(retryDelayMilliseconds(20)).toBe(60_000);
  });

  it("fails only an already-aborted job", () => {
    expect(() => throwIfCharacterJobAborted(undefined)).not.toThrow();
    expect(() => throwIfCharacterJobAborted(new AbortController().signal)).not.toThrow();
    const controller = new AbortController();
    controller.abort();
    expectErrorCode(
      () => throwIfCharacterJobAborted(controller.signal),
      "CHARACTER_JOB_ABORTED",
    );
  });

  it("purges all created result artifacts and contains cleanup telemetry failures", async () => {
    const purge = vi.fn().mockResolvedValue(undefined);
    const context = cleanupContext(purge);
    await cleanupResultArtifacts(context, resultWithArtifacts("rig.psd", "rig.json"));
    expect(purge).toHaveBeenCalledTimes(2);

    const cleanupError = vi.fn(() => {
      throw new Error("telemetry unavailable");
    });
    const failing = cleanupContext(
      vi.fn().mockRejectedValue(new Error("storage unavailable")),
      cleanupError,
    );
    await expect(removeFailedArtifact(failing, "failed.psd")).resolves.toBeUndefined();
    expect(cleanupError).toHaveBeenCalledWith(expect.any(Error), "failed.psd");

    await expect(cleanupResultArtifacts(
      cleanupContext(vi.fn()),
      resultWithArtifacts(null, null),
    )).resolves.toBeUndefined();
  });
});

function payloadJob(payload: CharacterJob["payload"]): CharacterJob {
  return { payload } as CharacterJob;
}

function cleanupContext(
  purge: ReturnType<typeof vi.fn>,
  onArtifactCleanupError?: (error: unknown, objectKey: string) => void,
): CharacterJobExecutionContext {
  return {
    storage: { purge },
    onArtifactCleanupError,
  } as unknown as CharacterJobExecutionContext;
}

function resultWithArtifacts(
  psdKey: string | null,
  manifestKey: string | null,
): CharacterJobResult {
  const artifact = (objectKey: string) => ({ objectKey });
  return {
    kind: "rig",
    rig: {
      psdArtifact: psdKey ? artifact(psdKey) : null,
      manifestArtifact: manifestKey ? artifact(manifestKey) : null,
    },
  } as CharacterJobResult;
}

function expectErrorCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}
