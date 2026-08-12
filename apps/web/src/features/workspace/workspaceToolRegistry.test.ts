import { describe, expect, it } from "vitest";
import {
  getReadyWorkspaceTools,
  isWorkspaceShortcut,
  resolveWorkspaceToolDispatch,
} from "./workspaceToolRegistry";

describe("workspace tool registry", () => {
  const enabledFeatures = {
    characterRig: {
      enabled: true,
      unavailableReason: null,
      requiredCanonicalViews: 5,
      supportedProjectKinds: ["image"] as const,
    },
    pdfRegionOcr: { enabled: true, unavailableReason: null },
  };

  it("shows only implemented image commands in the primary rail", () => {
    const tools = getReadyWorkspaceTools("image", true, enabledFeatures);
    expect(tools.map((tool) => tool.id)).toEqual([
      "image.keep",
      "image.exclude",
      "image.separate",
      "image.erase",
      "image.undo",
      "image.redo",
      "image.edge-refine",
      "image.merge",
      "image.turntable",
      "source.versions",
    ]);
    expect(tools.every((tool) => tool.available)).toBe(true);
  });

  it("never exposes Character Turntable for PDF projects", () => {
    const bookTools = getReadyWorkspaceTools("book", true, enabledFeatures);
    expect(bookTools.some((tool) => tool.id === "image.turntable")).toBe(false);
    expect(enabledFeatures.characterRig.supportedProjectKinds).toEqual(["image"]);
  });


  it("disables source commands with a truthful reason before upload", () => {
    const tools = getReadyWorkspaceTools("book", false, enabledFeatures);
    expect(tools.every((tool) => !tool.available)).toBe(true);
    expect(tools.every((tool) => Boolean(tool.unavailableReason))).toBe(true);
    expect(resolveWorkspaceToolDispatch(tools[0]!)).toEqual({
      kind: "unavailable",
      reason: "ارفع مصدرًا وجهّزه أولًا لاستخدام هذه الأداة.",
    });
  });

  it("dispatches prompts, undo, redo, text operations, reading order, and source history", () => {
    const tools = getReadyWorkspaceTools("book", true, enabledFeatures);
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
    const imageTools = getReadyWorkspaceTools("image", true, enabledFeatures);
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
    expect(
      resolveWorkspaceToolDispatch(
        imageTools.find((tool) => tool.id === "image.turntable")!,
      ),
    ).toEqual({ kind: "character-rig" });
  });

  it("matches exactly the displayed shortcuts without H/R conflicts", () => {
    const tools = getReadyWorkspaceTools("book", true, enabledFeatures);
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

  it("disables regional OCR when the runtime capability is unavailable", () => {
    const tools = getReadyWorkspaceTools("book", true, {
      characterRig: enabledFeatures.characterRig,
      pdfRegionOcr: {
        enabled: false,
        unavailableReason: "الدليل الإنتاجي غير صالح بعد.",
      },
    });
    const regionalOcr = tools.find((tool) => tool.id === "pdf.region-ocr");

    expect(regionalOcr).toMatchObject({
      available: false,
      unavailableReason: "الدليل الإنتاجي غير صالح بعد.",
    });
    expect(resolveWorkspaceToolDispatch(regionalOcr!)).toEqual({
      kind: "unavailable",
      reason: "الدليل الإنتاجي غير صالح بعد.",
    });
  });
});
