import { describe, expect, it } from "vitest";
import type { Layer } from "../../types";
import {
  findTopPreviewLayerAtPoint,
  projectPreviewLayers,
} from "./layerPreviewProjection";

const layer = (changes: Partial<Layer>): Layer => ({
  id: "layer",
  name: "+layer",
  kind: "text",
  visible: true,
  locked: false,
  opacity: 100,
  color: "#000000",
  pageNumber: 1,
  ...changes,
});

describe("projectPreviewLayers", () => {
  it("shares visibility, opacity, solo, page, kind, and z-order rules", () => {
    const projected = projectPreviewLayers(
      [
        layer({ id: "hidden", visible: false }),
        layer({ id: "transparent", opacity: 0 }),
        layer({ id: "other-page", pageNumber: 2 }),
        layer({ id: "group", kind: "group" }),
        layer({ id: "top", zIndex: 4, readingOrder: 1 }),
        layer({ id: "selected", zIndex: 2, readingOrder: 2 }),
      ],
      { pageNumber: 1, kinds: ["text"] },
    );
    expect(projected.map(({ id }) => id)).toEqual(["selected", "top"]);
    expect(
      projectPreviewLayers(projected, { soloLayerId: "top" }).map(
        ({ id }) => id,
      ),
    ).toEqual(["top"]);
  });

  it("selects the topmost projected layer at a preview point", () => {
    const projected = projectPreviewLayers([
      layer({ id: "bottom", zIndex: 1, bounds: { x: 0, y: 0, width: 80, height: 80 } }),
      layer({ id: "top", zIndex: 2, bounds: { x: 20, y: 20, width: 20, height: 20 } }),
    ]);
    expect(findTopPreviewLayerAtPoint(projected, { x: 25, y: 25 })?.id).toBe("top");
    expect(findTopPreviewLayerAtPoint(projected, { x: 90, y: 90 })).toBeUndefined();
  });
});
