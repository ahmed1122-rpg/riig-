import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./transport", () => ({ request }));

import {
  listSourceVersions,
  restoreSourceVersion,
} from "./source-versions-client";

describe("source version client routes", () => {
  beforeEach(() => request.mockReset());

  it("encodes project identifiers when listing versions", async () => {
    request.mockResolvedValue([]);

    await listSourceVersions("project/1");

    expect(request).toHaveBeenCalledWith(
      "/v1/projects/project%2F1/source-versions",
      { signal: undefined },
    );
  });

  it("preserves the explicit idempotency key when restoring", async () => {
    request.mockResolvedValue({});

    await restoreSourceVersion("project/1", "version 1", {
      expectedCurrentSourceVersionId: "current-1",
      reason: "rollback",
      idempotencyKey: "restore-key",
    });

    expect(request).toHaveBeenCalledWith(
      "/v1/projects/project%2F1/source-versions/version%201/restore",
      expect.objectContaining({
        method: "POST",
        headers: { "x-idempotency-key": "restore-key" },
      }),
    );
  });
});
