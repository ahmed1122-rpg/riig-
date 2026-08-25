import type { Layer } from "../../types";

export function isPageLayer(
  layer: Pick<Layer, "kind" | "presentationKind">,
): boolean {
  return layer.kind === "raster" && layer.presentationKind === "page";
}

export function isLayerContentEditable(layer: Layer): boolean {
  return (
    !isPageLayer(layer) &&
    layer.kind !== "group" &&
    !layer.fixed &&
    !layer.locked
  );
}
