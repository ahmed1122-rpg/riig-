/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "../../types";
import {
  navigateLayerSelection,
  openLayerDiagnostic,
} from "./layerDockNavigation";

const layer = (id: string, pageNumber = 1): Layer => ({
  id,
  name: `+${id}`,
  kind: "text",
  visible: true,
  locked: false,
  opacity: 100,
  color: "#111111",
  pageNumber,
});

afterEach(() => vi.restoreAllMocks());

describe("layer dock navigation", () => {
  it("selects the next filtered layer", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const onSelectionChange = vi.fn();
    navigateLayerSelection({
      layers: [layer("first"), layer("second")],
      layerId: "first",
      direction: "next",
      onSelectionChange,
    });
    expect(onSelectionChange).toHaveBeenCalledWith(["second"], "second");
  });

  it("does not open a diagnostic when guarded page navigation is rejected", async () => {
    const onSelectionChange = vi.fn();
    const onOpenLayers = vi.fn();
    await openLayerDiagnostic({
      layerId: "target",
      layers: [layer("target", 2)],
      mode: "book",
      activePdfPage: 1,
      dock: null,
      onPdfPageChange: vi.fn(async () => false),
      onSelectionChange,
      onActiveLayerChange: vi.fn(),
      onOpenLayers,
    });
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(onOpenLayers).not.toHaveBeenCalled();
  });
});
