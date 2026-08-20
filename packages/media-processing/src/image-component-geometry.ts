import type { LayerBounds } from "@motionprep/contracts";

export interface ComponentStats {
  label: number;
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function containsTransparency(pixels: Buffer): boolean {
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset] !== 255) return true;
  }
  return false;
}

export function toBounds(component: ComponentStats): LayerBounds {
  return {
    x: component.minX,
    y: component.minY,
    width: component.maxX - component.minX + 1,
    height: component.maxY - component.minY + 1,
  };
}

export function unionBounds(
  components: readonly ComponentStats[],
): LayerBounds {
  const minX = Math.min(...components.map(({ minX }) => minX));
  const minY = Math.min(...components.map(({ minY }) => minY));
  const maxX = Math.max(...components.map(({ maxX }) => maxX));
  const maxY = Math.max(...components.map(({ maxY }) => maxY));
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}
