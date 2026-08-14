import { describe, expect, it } from "vitest";
import { layerReorderIssue } from "./layerReorderGuard";

describe("layerReorderIssue", () => {
  it("allows reordering siblings in the same page folder", () => {
    expect(
      layerReorderIssue(
        { pageNumber: 2, parentId: "topic" },
        { pageNumber: 2, parentId: "topic" },
      ),
    ).toBeUndefined();
  });

  it("rejects cross-page and cross-folder drops with actionable reasons", () => {
    expect(
      layerReorderIssue(
        { pageNumber: 1, parentId: "page-1" },
        { pageNumber: 2, parentId: "page-2" },
      ),
    ).toContain("بين صفحات PDF");
    expect(
      layerReorderIssue(
        { pageNumber: 1, parentId: "heading" },
        { pageNumber: 1, parentId: "body" },
      ),
    ).toContain("داخل المجلد نفسه");
  });
});
