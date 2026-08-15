import type { Layer } from "../../types";

export function isPageLayer(
  layer: Pick<Layer, "kind" | "presentationKind">,
): boolean {
  return layer.kind === "raster" && layer.presentationKind === "page";
}
