/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "../../types";
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

  it("explains a merge rejection before opening the PDF operation", () => {
    const onNotify = vi.fn();
    const textLayer: Layer = {
      id: "text-1",
      name: "+سطر_01",
      kind: "text",
      parentId: "page-1",
      visible: true,
      locked: false,
      fixed: false,
      opacity: 1,
      color: "#2563eb",
      pageNumber: 1,
      fullText: "السطر الأول",
      bounds: { x: 0, y: 0, width: 100, height: 20 },
    };
    const bookLayers = [
      textLayer,
      {
        ...textLayer,
        id: "text-2",
        name: "+سطر_02",
        parentId: "page-2",
      },
    ];
    const { result } = renderHook(() =>
      useWorkspaceToolController({
        mode: "book",
        persistedSource: true,
        features,
        activeLayer: bookLayers[0],
        selectedIds: bookLayers.map((layer) => layer.id),
        imageLayers: [],
        bookLayers,
        onArrangeReadingOrder: vi.fn(),
        onNotify,
      }),
    );
    const mergeTool = result.current.workspaceTools.find(
      (tool) => tool.id === "pdf.merge",
    );
    expect(mergeTool).toBeDefined();

    act(() => {
      if (mergeTool) result.current.useTool(mergeTool);
    });

    expect(onNotify).toHaveBeenCalledWith(
      "يجب أن تكون الطبقات داخل المجلد نفسه قبل الدمج.",
    );
    expect(result.current.pdfTextOperation).toBeUndefined();
  });

  it("routes every dialog and document command to an observable controller state", () => {
    const onArrangeReadingOrder = vi.fn();
    const textLayer = layer({ kind: "text", fullText: "نص صالح", pageNumber: 1 });
    const { result } = renderHook(() =>
      useWorkspaceToolController({
        mode: "book",
        persistedSource: true,
        features,
        activeLayer: textLayer,
        selectedIds: [textLayer.id],
        imageLayers: [],
        bookLayers: [textLayer],
        onArrangeReadingOrder,
        onNotify: vi.fn(),
      }),
    );

    useRegisteredTool(result, "pdf.reading-order");
    expect(onArrangeReadingOrder).toHaveBeenCalledOnce();
    useRegisteredTool(result, "source.versions");
    expect(result.current.sourceVersionsOpen).toBe(true);
    useRegisteredTool(result, "pdf.region-ocr");
    expect(result.current.pdfRegionOcrLayerId).toBe(textLayer.id);
    useRegisteredTool(result, "pdf.split");
    expect(result.current.pdfTextOperation).toEqual({
      operation: "split",
      layerIds: [textLayer.id],
    });
  });

  it("routes image refinement, merging, character studio, and editor commands", () => {
    const first = layer({ id: "raster-1" });
    const second = layer({ id: "raster-2", name: "+عنصر_02" });
    const { result } = renderHook(() =>
      useWorkspaceToolController({
        mode: "image",
        persistedSource: true,
        features,
        activeLayer: first,
        selectedIds: [first.id, second.id],
        imageLayers: [first, second],
        bookLayers: [],
        onArrangeReadingOrder: vi.fn(),
        onNotify: vi.fn(),
      }),
    );

    useRegisteredTool(result, "image.edge-refine");
    expect(result.current.imageRasterOperation).toEqual({
      operation: "edge-refine",
      layerIds: [first.id],
    });
    useRegisteredTool(result, "image.merge");
    expect(result.current.imageRasterOperation).toEqual({
      operation: "merge",
      layerIds: [first.id, second.id],
    });
    useRegisteredTool(result, "image.turntable");
    expect(result.current.characterStudioOpen).toBe(true);
    useRegisteredTool(result, "image.exclude");
    expect(result.current.activeTool).toBe("image.exclude");
    expect(result.current.editorCommand).toMatchObject({
      id: "image.exclude",
      sequence: 1,
    });
  });
});

function layer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: "raster-1",
    name: "+عنصر_01",
    kind: "raster",
    visible: true,
    locked: false,
    fixed: false,
    opacity: 1,
    color: "#2563eb",
    bounds: { x: 0, y: 0, width: 100, height: 20 },
    ...overrides,
  };
}

function useRegisteredTool(
  result: ReturnType<typeof renderHook<ReturnType<typeof useWorkspaceToolController>, unknown>>["result"],
  id: string,
) {
  const tool = result.current.workspaceTools.find((candidate) => candidate.id === id);
  expect(tool).toBeDefined();
  act(() => {
    if (tool) result.current.useTool(tool);
  });
}
