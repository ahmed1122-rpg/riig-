/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "../../types";
import { LayerRow, type LayerRowProps } from "./LayerDockPanels";

const rasterLayer: Layer = {
  id: "raster-1",
  name: "+جزء_01",
  kind: "raster",
  presentationKind: "body",
  visible: true,
  locked: false,
  opacity: 1,
  color: "#2563eb",
};

function renderLayerRow(layer: Layer, duplicate = false) {
  const noop = vi.fn();
  const props: LayerRowProps = {
    layer,
    selected: false,
    active: true,
    duplicate,
    renaming: false,
    renameDraft: layer.name,
    renameError: "",
    canReorder: true,
    dragging: false,
    dragOverPosition: undefined,
    onRenameDraftChange: noop,
    onSelect: noop,
    onStartRename: noop,
    onSaveRename: noop,
    onCancelRename: noop,
    onToggleVisible: noop,
    onToggleLock: noop,
    onMove: noop,
    onNavigate: noop,
    onDragStart: noop,
    onDragOver: noop,
    onDrop: noop,
    onDragEnd: noop,
  };

  render(<LayerRow {...props} />);
}

afterEach(cleanup);

describe("LayerRow raster confidence", () => {
  it("does not invent a quality percentage when confidence is absent", () => {
    renderLayerRow(rasterLayer);

    expect(screen.getByText("جزء صورة · الثقة غير متاحة")).toBeTruthy();
    expect(screen.queryByText(/94%/u)).toBeNull();
  });

  it("shows the measured confidence when the document supplies it", () => {
    renderLayerRow({ ...rasterLayer, confidence: 87 });

    expect(screen.getByText("87% · جزء صورة")).toBeTruthy();
  });

  it("makes duplicate names visible in both text and row semantics", () => {
    renderLayerRow(rasterLayer, true);

    expect(screen.getByText("اسم مكرر")).toBeTruthy();
    const row = screen.getByRole("group", { name: /\+جزء_01/u });
    expect(row.classList.contains("is-duplicate")).toBe(true);
    expect(row.getAttribute("aria-label")).toContain(
      "اسم مكرر",
    );
  });

  it.each(["+Right_Arm", "+ذراع_يمين"])(
    "renders %s using browser-native direction detection",
    (name) => {
      renderLayerRow({ ...rasterLayer, name });

      expect(screen.getByText(name).getAttribute("dir")).toBe("auto");
    },
  );
});
