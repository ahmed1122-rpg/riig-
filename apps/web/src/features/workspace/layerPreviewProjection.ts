import type { Layer } from "../../types";

interface LayerPreviewProjectionOptions {
  pageNumber?: number;
  soloLayerId?: string;
  hiddenLayerIds?: readonly string[];
  kinds?: readonly Layer["kind"][];
}

export function projectPreviewLayers(
  layers: readonly Layer[],
  options: LayerPreviewProjectionOptions = {},
): Layer[] {
  const hidden = new Set(options.hiddenLayerIds ?? []);
  const kinds = options.kinds ? new Set(options.kinds) : undefined;
  return layers
    .filter((layer) => {
      if (layer.kind === "group" || layer.kind === "page") return false;
      if (!layer.visible || layer.opacity <= 0 || hidden.has(layer.id)) {
        return false;
      }
      if (
        options.pageNumber !== undefined &&
        layer.pageNumber !== options.pageNumber
      ) {
        return false;
      }
      if (options.soloLayerId && layer.id !== options.soloLayerId) return false;
      return !kinds || kinds.has(layer.kind);
    })
    .slice()
    .sort(
      (left, right) =>
        (left.zIndex ?? 0) - (right.zIndex ?? 0) ||
        (left.readingOrder ?? Number.MAX_SAFE_INTEGER) -
          (right.readingOrder ?? Number.MAX_SAFE_INTEGER),
    );
}

export function findTopPreviewLayerAtPoint(
  layers: readonly Layer[],
  point: { x: number; y: number },
): Layer | undefined {
  return layers
    .slice()
    .reverse()
    .find((layer) => {
      const bounds = layer.bounds;
      return Boolean(
        bounds &&
          point.x >= bounds.x &&
          point.x <= bounds.x + bounds.width &&
          point.y >= bounds.y &&
          point.y <= bounds.y + bounds.height,
      );
    });
}
