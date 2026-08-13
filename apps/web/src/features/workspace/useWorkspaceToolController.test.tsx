/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceToolController } from "./useWorkspaceToolController";

const features = {
  characterRig: {
    enabled: true,
    unavailableReason: null,
    requiredCanonicalViews: 5,
    supportedProjectKinds: ["image"] as const,
  },
  pdfRegionOcr: { enabled: true, unavailableReason: null },
};

function useController() {
  return useWorkspaceToolController({
    mode: "image",
    persistedSource: true,
    features,
    activeLayer: undefined,
    selectedIds: [],
    imageLayers: [],
    bookLayers: [],
    onArrangeReadingOrder: vi.fn(),
    onNotify: vi.fn(),
  });
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("useWorkspaceToolController", () => {
  it("clears every transient tool dialog during a mode reset", () => {
    const { result } = renderHook(useController);
    act(() => {
      result.current.setSourceVersionsOpen(true);
      result.current.setPdfTextOperation({
        operation: "split",
        layerIds: ["layer-1"],
      });
      result.current.setPdfRegionOcrLayerId("layer-1");
      result.current.setImageRasterOperation({
        operation: "edge-refine",
        layerIds: ["layer-1"],
      });
      result.current.setCharacterStudioOpen(true);
      result.current.resetToolState("book");
    });

    expect(result.current.sourceVersionsOpen).toBe(false);
    expect(result.current.pdfTextOperation).toBeUndefined();
    expect(result.current.pdfRegionOcrLayerId).toBeUndefined();
    expect(result.current.imageRasterOperation).toBeUndefined();
    expect(result.current.characterStudioOpen).toBe(false);
    expect(result.current.activeTool).toBe("pdf.line");
  });

  it("does not route global tool shortcuts behind a modal dialog", () => {
    const { result } = renderHook(useController);
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    document.body.append(modal);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "2" }));
    });
    expect(result.current.activeTool).toBe("image.keep");

    modal.remove();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "2" }));
    });
    expect(result.current.activeTool).toBe("image.exclude");
  });
});
