import { describe, expect, it } from "vitest";
import {
  getPlannedWorkspaceTools,
  getReadyWorkspaceTools,
  getVisiblePlannedWorkspaceTools,
  isWorkspaceShortcut,
  resolveWorkspaceToolDispatch,
} from "./workspaceToolRegistry";

describe("workspace tool registry", () => {
  it("shows only implemented image commands in the primary rail", () => {
    const tools = getReadyWorkspaceTools("image", true);
    expect(tools.map((tool) => tool.id)).toEqual([
      "image.keep",
      "image.exclude",
      "image.separate",
      "image.erase",
      "image.undo",
      "image.redo",
      "image.edge-refine",
      "image.merge",
      "source.versions",
    ]);
    expect(tools.every((tool) => tool.available)).toBe(true);
    expect(getPlannedWorkspaceTools("image")).toEqual([]);
  });

  it("hides planned tools when production visibility is disabled", () => {
    expect(getVisiblePlannedWorkspaceTools("image", false)).toEqual([]);
    expect(getVisiblePlannedWorkspaceTools("image", true)).toEqual(
      getPlannedWorkspaceTools("image"),
    );
  });

  it("disables source commands with a truthful reason before upload", () => {
    const tools = getReadyWorkspaceTools("book", false);
    expect(tools.every((tool) => !tool.available)).toBe(true);
    expect(tools.every((tool) => Boolean(tool.unavailableReason))).toBe(true);
    expect(resolveWorkspaceToolDispatch(tools[0]!)).toEqual({
      kind: "unavailable",
      reason: "ارفع مصدرًا وجهّزه أولًا لاستخدام هذه الأداة.",
    });
  });

  it("dispatches prompts, undo, redo, text operations, reading order, and source history", () => {
    const tools = getReadyWorkspaceTools("book", true);
    expect(
      resolveWorkspaceToolDispatch(
        tools.find((tool) => tool.id === "pdf.line")!,
      ),
    ).toEqual({ kind: "editor", id: "pdf.line", selectPrompt: true });
    expect(
      resolveWorkspaceToolDispatch(
        tools.find((tool) => tool.id === "pdf.undo")!,
      ),
    ).toEqual({ kind: "editor", id: "pdf.undo", selectPrompt: false });
    expect(
      resolveWorkspaceToolDispatch(
        tools.find((tool) => tool.id === "pdf.redo")!,
      ),
    ).toEqual({ kind: "editor", id: "pdf.redo", selectPrompt: false });
    expect(
      resolveWorkspaceToolDispatch(
        tools.find((tool) => tool.id === "pdf.reading-order")!,
      ),
    ).toEqual({ kind: "reading-order" });
    expect(
      resolveWorkspaceToolDispatch(
        tools.find((tool) => tool.id === "source.versions")!,
      ),
    ).toEqual({ kind: "source-versions" });
    expect(
      resolveWorkspaceToolDispatch(
        tools.find((tool) => tool.id === "pdf.split")!,
      ),
    ).toEqual({ kind: "pdf-split" });
    expect(
      resolveWorkspaceToolDispatch(
        tools.find((tool) => tool.id === "pdf.merge")!,
      ),
    ).toEqual({ kind: "pdf-merge" });
    expect(
      resolveWorkspaceToolDispatch(
        tools.find((tool) => tool.id === "pdf.region-ocr")!,
      ),
    ).toEqual({ kind: "pdf-region-ocr" });
    expect(getPlannedWorkspaceTools("book")).toEqual([]);
    const imageTools = getReadyWorkspaceTools("image", true);
    expect(
      resolveWorkspaceToolDispatch(
        imageTools.find((tool) => tool.id === "image.edge-refine")!,
      ),
    ).toEqual({ kind: "image-edge-refine" });
    expect(
      resolveWorkspaceToolDispatch(
        imageTools.find((tool) => tool.id === "image.merge")!,
      ),
    ).toEqual({ kind: "image-merge" });
  });

  it("matches exactly the displayed shortcuts without H/R conflicts", () => {
    const tools = getReadyWorkspaceTools("book", true);
    const event = {
      key: "h",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    };
    expect(
      tools.filter((tool) => isWorkspaceShortcut(tool, event)).map((tool) => tool.id),
    ).toEqual(["pdf.heading"]);
    expect(
      tools.filter((tool) =>
        isWorkspaceShortcut(tool, { ...event, key: "r", altKey: true }),
      ).map((tool) => tool.id),
    ).toEqual(["pdf.reading-order"]);
    expect(
      tools.filter((tool) =>
        isWorkspaceShortcut(tool, {
          ...event,
          key: "z",
          ctrlKey: true,
          shiftKey: true,
        }),
      ).map((tool) => tool.id),
    ).toEqual(["pdf.redo"]);
  });
});
