import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./transport", () => ({
  API_ORIGIN: "http://127.0.0.1:4000",
  request,
}));

import {
  characterRigArtifactUrl,
  compileCharacterRig,
  reviewCharacterRig,
} from "./character-rig-client";

describe("character rig client", () => {
  beforeEach(() => request.mockReset().mockResolvedValue({}));

  it("keeps source compile, review, and artifact routes project scoped", async () => {
    await compileCharacterRig("project 1", {
      bibleId: "bible-1",
      sourceVersionId: "source-1",
      width: 1500,
      height: 1500,
    });
    await reviewCharacterRig("project 1", "rig/1", {
      decision: "approved",
      reason: "Rig hierarchy matches.",
    });

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "/v1/projects/project%201/character-rig/compile",
      "/v1/projects/project%201/character-rig/rigs/rig%2F1/reviews",
    ]);
    expect(characterRigArtifactUrl("project 1", "rig/1", "manifest")).toBe(
      "http://127.0.0.1:4000/v1/projects/project%201/character-rig/rigs/rig%2F1/artifacts/manifest",
    );
  });

});
