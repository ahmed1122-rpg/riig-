import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Layer } from "../../types";
import { RasterLayerPreview } from "./RasterLayerPreview";

const layers: Layer[] = [
  {
    id: "back",
    name: "+جزء_01",
    kind: "body",
    visible: true,
    locked: false,
    opacity: 100,
    zIndex: 0,
    color: "#000",
    previewUrl: "blob:back",
    bounds: { x: 2, y: 3, width: 20, height: 10 },
  },
  {
    id: "front",
    name: "+جزء_02",
    kind: "body",
    visible: true,
    locked: false,
    opacity: 60,
    zIndex: 2,
    color: "#fff",
    previewUrl: "blob:front",
    bounds: { x: 30, y: 5, width: 8, height: 9 },
  },
];

describe("RasterLayerPreview", () => {
  it("places independently stored assets in document coordinates", () => {
    const markup = renderToStaticMarkup(
      <RasterLayerPreview
        layers={layers}
        canvasWidth={100}
        canvasHeight={50}
        selectedLayerId="front"
        label="طبقات فعلية"
      />,
    );

    expect(markup).toContain('viewBox="0 0 100 50"');
    expect(markup.indexOf("blob:back")).toBeLessThan(
      markup.indexOf("blob:front"),
    );
    expect(markup).toContain('href="blob:front"');
    expect(markup).toContain('x="30"');
    expect(markup).toContain('opacity="0.6"');
    expect(markup).toContain("raster-layer-selection");
  });

  it("omits hidden and solo-suppressed assets", () => {
    const markup = renderToStaticMarkup(
      <RasterLayerPreview
        layers={[layers[0]!, { ...layers[1]!, visible: false }]}
        canvasWidth={100}
        canvasHeight={50}
        selectedLayerId="back"
        hiddenLayerIds={["back"]}
        label="طبقات فعلية"
      />,
    );

    expect(markup).not.toContain("<image");
  });
});
