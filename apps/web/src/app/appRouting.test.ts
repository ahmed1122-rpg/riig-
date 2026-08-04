import { describe, expect, it } from "vitest";
import {
  appLocation,
  buildAppViewLocation,
  workspaceEntryForView,
} from "./appRouting";

const workspace = {
  mode: "book" as const,
  project: {
    id: "project-1",
    name: "كتاب",
    currentSourceVersionId: "source-2",
    currentSourceVersionNumber: 2,
  },
};

describe("app routing", () => {
  it("builds a workspace location and preserves the current workspace only there", () => {
    expect(
      buildAppViewLocation({
        pathname: "/studio",
        currentSearch: "?payment=cancelled",
        nextView: "workspace",
        workspace,
      }),
    ).toContain("/studio?view=workspace");
    expect(
      workspaceEntryForView("workspace", undefined, workspace),
    ).toBe(workspace);
    expect(workspaceEntryForView("projects", undefined, workspace)).toBeUndefined();
    expect(appLocation("/studio", "?view=projects")).toBe(
      "/studio?view=projects",
    );
  });
});
