import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./transport", () => ({
  API_ORIGIN: "http://127.0.0.1:4000",
  request,
}));

import {
  bootstrapCharacterIdentity,
  characterGenerationArtifactUrl,
  characterRigArtifactUrl,
  compileCharacterRig,
  queueCharacterGeneration,
  reviewCharacterGeneration,
  reviewCharacterRig,
} from "./character-rig-client";

describe("character rig client", () => {
  beforeEach(() => request.mockReset().mockResolvedValue({}));

  it("queues controlled generation with private references only by identifier", async () => {
    await queueCharacterGeneration("project/1", {
      bibleId: "bible-1",
      identityModelVersionId: "model-1",
      target: { kind: "canonical-view", view: "left-profile" },
      angleDegrees: -90,
      seed: 42,
      canvas: { width: 1_024, height: 1_024 },
    });

    expect(request).toHaveBeenCalledWith(
      "/v1/projects/project%2F1/character-rig/generations",
      expect.objectContaining({
        method: "POST",
        headers: { "x-idempotency-key": expect.any(String) },
        body: JSON.stringify({
          bibleId: "bible-1",
          identityModelVersionId: "model-1",
          target: { kind: "canonical-view", view: "left-profile" },
          controls: {
            seed: 42,
            canvas: { width: 1_024, height: 1_024 },
            poseReferenceId: null,
            depthReferenceId: null,
            maskReferenceId: null,
            parameters: { angleDegrees: -90 },
          },
        }),
      }),
    );
  });

  it("keeps model, review, compile, and artifact routes project scoped", async () => {
    await bootstrapCharacterIdentity("project 1", "bible-1");
    await reviewCharacterGeneration("project 1", "attempt/1", {
      decision: "approved",
      reason: "Identity matches.",
    });
    await compileCharacterRig("project 1", {
      bibleId: "bible-1",
      width: 1500,
      height: 1500,
    });
    await reviewCharacterRig("project 1", "rig/1", {
      decision: "approved",
      reason: "Rig hierarchy matches.",
    });

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "/v1/projects/project%201/character-rig/identity-model",
      "/v1/projects/project%201/character-rig/generations/attempt%2F1/reviews",
      "/v1/projects/project%201/character-rig/compile",
      "/v1/projects/project%201/character-rig/rigs/rig%2F1/reviews",
    ]);
    expect(characterGenerationArtifactUrl("project 1", "attempt/1")).toBe(
      "http://127.0.0.1:4000/v1/projects/project%201/character-rig/generations/attempt%2F1/artifact",
    );
    expect(characterRigArtifactUrl("project 1", "rig/1", "manifest")).toBe(
      "http://127.0.0.1:4000/v1/projects/project%201/character-rig/rigs/rig%2F1/artifacts/manifest",
    );
  });

  it("passes an isolated mask reference for masked repair", async () => {
    await queueCharacterGeneration("project-1", {
      bibleId: "bible-1",
      identityModelVersionId: "model-1",
      target: { kind: "masked-repair", view: "frontal", partName: "left-eye" },
      angleDegrees: 0,
      seed: 7,
      canvas: { width: 512, height: 512 },
      maskReferenceId: "mask-reference-1",
    });

    expect(JSON.parse(request.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      controls: { maskReferenceId: "mask-reference-1" },
    });
  });
});
