import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api";
import { isWorkspaceRevisionConflict } from "./workspaceConflict";

describe("workspace revision conflicts", () => {
  it("recognizes document conflicts without treating every 409 as reloadable", () => {
    expect(
      isWorkspaceRevisionConflict(
        new ApiError("DOCUMENT_REVISION_CONFLICT", "stale", 409),
      ),
    ).toBe(true);
    expect(
      isWorkspaceRevisionConflict(
        new ApiError("IDEMPOTENCY_CONFLICT", "different request", 409),
      ),
    ).toBe(false);
  });
});
