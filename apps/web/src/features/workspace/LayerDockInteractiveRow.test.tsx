/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "../../types";
import {
  LayerDockInteractiveRow,
  layerDropPosition,
} from "./LayerDockInteractiveRow";

const targetLayer: Layer = {
  id: "target",
  name: "+target",
  kind: "body",
  visible: true,
  locked: false,
  opacity: 100,
  color: "#2563eb",
};

afterEach(cleanup);

describe("layer drag-and-drop position", () => {
  it("maps the upper and lower halves to before and after", () => {
    expect(layerDropPosition(119, 100, 40)).toBe("before");
    expect(layerDropPosition(120, 100, 40)).toBe("after");
  });

  it("moves after the target when dropped in its lower half", () => {
    const onMoveTo = vi.fn();
    const onDragOverTargetChange = vi.fn();
    const noop = vi.fn();
    const { container } = render(
      <LayerDockInteractiveRow
        layer={targetLayer}
        selected={false}
        active
        duplicate={false}
        canReorder
        renaming={false}
        renameDraft={targetLayer.name}
        renameError=""
        draggedLayerId="source"
        dragOverTarget={undefined}
        onRenameDraftChange={noop}
        onSelect={noop}
        onStartRename={noop}
        onSaveRename={noop}
        onCancelRename={noop}
        onToggleVisible={noop}
        onToggleLock={noop}
        onMove={noop}
        onNavigate={noop}
        onMoveTo={onMoveTo}
        onDraggedLayerChange={noop}
        onDragOverTargetChange={onDragOverTargetChange}
      />,
    );
    const row = container.querySelector<HTMLElement>(".pro-layer-row");
    expect(row).not.toBeNull();
    vi.spyOn(row!, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 100,
      top: 100,
      right: 300,
      bottom: 140,
      left: 0,
      width: 300,
      height: 40,
      toJSON: () => ({}),
    });
    const dataTransfer = {
      dropEffect: "none",
      getData: vi.fn(() => "source"),
      setData: vi.fn(),
    };

    fireEvent.dragOver(row!, { clientY: 131, dataTransfer });
    expect(onDragOverTargetChange).toHaveBeenCalledWith({
      layerId: "target",
      position: "after",
    });

    fireEvent.drop(row!, { clientY: 131, dataTransfer });
    expect(onMoveTo).toHaveBeenCalledWith("source", "target", "after");
  });
});
