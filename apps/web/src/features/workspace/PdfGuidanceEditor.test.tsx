/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "../../types";
import { PdfGuidanceEditor } from "./PdfGuidanceEditor";

afterEach(cleanup);

const textLayer = (changes: Partial<Layer> = {}): Layer => ({
  id: "text-1",
  name: "+line_001",
  kind: "text",
  visible: true,
  locked: false,
  opacity: 100,
  color: "#111111",
  pageNumber: 1,
  bounds: { x: 5, y: 5, width: 60, height: 20 },
  fullContent: "النص الأصلي",
  ...changes,
});

function renderEditor(layer: Layer, onTextLayerChange = vi.fn()) {
  const onNotify = vi.fn();
  const result = render(
    <PdfGuidanceEditor
      segmentation="lines"
      layers={[layer]}
      pageSize={{ width: 100, height: 100 }}
      onSegmentationChange={vi.fn()}
      onNotify={onNotify}
      onApply={vi.fn(async () => ({ revision: 1, warnings: [] }))}
      onHistoryNavigate={vi.fn(async () => undefined)}
      onTextLayerChange={onTextLayerChange}
    />,
  );
  const overlay = result.container.querySelector<SVGSVGElement>(
    ".pdf-marker-overlay",
  );
  expect(overlay).not.toBeNull();
  vi.spyOn(overlay!, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    right: 100,
    bottom: 100,
    left: 0,
    width: 100,
    height: 100,
    toJSON: () => ({}),
  });
  return { ...result, onNotify, onTextLayerChange, overlay: overlay! };
}

describe("PdfGuidanceEditor inline text editing", () => {
  it("updates an unlocked text layer on Ctrl+Enter", () => {
    const onTextLayerChange = vi.fn();
    const { overlay } = renderEditor(textLayer(), onTextLayerChange);

    fireEvent.doubleClick(overlay, { clientX: 10, clientY: 10 });
    const editor = screen.getByRole("textbox");
    fireEvent.change(editor, { target: { value: "  النص المصحح  " } });
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });

    expect(onTextLayerChange).toHaveBeenCalledOnce();
    expect(onTextLayerChange).toHaveBeenCalledWith("text-1", "النص المصحح");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("does not edit a locked layer", () => {
    const { overlay, onNotify, onTextLayerChange } = renderEditor(
      textLayer({ locked: true }),
    );

    fireEvent.doubleClick(overlay, { clientX: 10, clientY: 10 });

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onTextLayerChange).not.toHaveBeenCalled();
    expect(onNotify).toHaveBeenCalledOnce();
  });
});
