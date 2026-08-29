/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "../../types";
import { ImageGuidanceEditor } from "./ImageGuidanceEditor";

afterEach(cleanup);

const rasterLayer: Layer = {
  id: "raster-1",
  name: "+source",
  kind: "raster",
  visible: true,
  locked: false,
  opacity: 100,
  color: "#2563eb",
  previewUrl: "blob:raster-1",
  bounds: { x: 0, y: 0, width: 100, height: 100 },
};

describe("ImageGuidanceEditor", () => {
  it("applies a keyboard coordinate marker as a valid one-point stroke", async () => {
    const onApply = vi.fn(async () => ({ revision: 2, warnings: [] }));
    const onNotify = vi.fn();
    const renderEditor = (guidanceRevision = 1) => (
      <ImageGuidanceEditor
        layers={[rasterLayer]}
        hiddenLayers={[]}
        selectedLayerId={rasterLayer.id}
        onSelectedLayerChange={vi.fn()}
        canvasSize={{ width: 100, height: 100 }}
        guidanceRevision={guidanceRevision}
        onApply={onApply}
        onNotify={onNotify}
        onHistoryNavigate={vi.fn(async () => undefined)}
      />
    );
    const view = render(renderEditor());

    fireEvent.change(screen.getByLabelText("الموضع الأفقي %"), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByLabelText("الموضع الرأسي %"), {
      target: { value: "75" },
    });
    fireEvent.click(screen.getByRole("button", { name: "إضافة إشارة" }));
    fireEvent.click(screen.getByRole("button", {
      name: "تطبيق وحفظ القناع",
    }));

    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    expect(onApply).toHaveBeenCalledWith({
      mode: "guided",
      strokes: [expect.objectContaining({
        prompt: "keep",
        size: 16,
        points: [{ x: 0.25, y: 0.75 }],
      })],
    });
    expect(onNotify).toHaveBeenCalledWith(
      "تم تطبيق القناع على أصل Raster وحفظ مراجعة جديدة.",
    );

    view.rerender(renderEditor(2));
    expect(screen.getByText("تم حفظ مراجعة Raster جديدة")).toBeTruthy();
  });
});
