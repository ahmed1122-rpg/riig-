import type { LayerBounds } from "@motionprep/contracts";

export function unionLayerBounds(bounds: readonly LayerBounds[]): LayerBounds {
  const left = Math.min(...bounds.map((value) => value.x));
  const top = Math.min(...bounds.map((value) => value.y));
  const right = Math.max(...bounds.map((value) => value.x + value.width));
  const bottom = Math.max(...bounds.map((value) => value.y + value.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
