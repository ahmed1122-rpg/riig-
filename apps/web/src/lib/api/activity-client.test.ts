import { describe, expect, it, vi } from "vitest";
import { request } from "./transport";
import { listWorkflowActivity } from "./activity-client";

vi.mock("./transport", () => ({ request: vi.fn() }));

describe("activity client", () => {
  it("preserves the opaque cursor and forwards cancellation", () => {
    const controller = new AbortController();
    vi.mocked(request).mockResolvedValue({
      items: [],
      summary: { active: 0, needsAttention: 0, failed: 0 },
      nextCursor: null,
      generatedAt: "2026-08-04T08:10:00.000Z",
    });

    void listWorkflowActivity({
      limit: 7,
      cursor: "opaque/+cursor",
      signal: controller.signal,
    });

    expect(request).toHaveBeenCalledWith(
      "/v1/activity?limit=7&cursor=opaque%2F%2Bcursor",
      { signal: controller.signal },
    );
  });
});
