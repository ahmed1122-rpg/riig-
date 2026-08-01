import type { Layer } from "../../types";

export interface LayerReviewUpdate {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  zIndex: number;
  readingOrder?: number;
}

export type LayerReviewSnapshot = ReadonlyMap<string, string>;

export function snapshotLayerReview(
  layers: readonly Layer[],
): LayerReviewSnapshot {
  return new Map(layers.map((layer) => [layer.id, signature(layer)]));
}

export function collectLayerReviewUpdates(
  layers: readonly Layer[],
  snapshot: LayerReviewSnapshot,
): LayerReviewUpdate[] {
  return layers.flatMap((layer) =>
    snapshot.get(layer.id) === signature(layer)
      ? []
      : [
          {
            id: layer.id,
            name: layer.name,
            visible: layer.visible,
            locked: layer.locked,
            opacity: Math.min(1, Math.max(0, layer.opacity / 100)),
            zIndex: layer.zIndex ?? 0,
            ...(layer.readingOrder === undefined
              ? {}
              : { readingOrder: layer.readingOrder }),
          },
        ],
  );
}

function signature(layer: Layer): string {
  return JSON.stringify([
    layer.name,
    layer.visible,
    layer.locked,
    layer.opacity,
    layer.zIndex ?? 0,
    layer.readingOrder ?? null,
  ]);
}

export function reindexLayerOrder(layers: readonly Layer[]): Layer[] {
  const editableCount = layers.filter((layer) => layer.kind !== "page").length;
  let nextZIndex = editableCount;
  const readingOrderByPage = new Map<number, number>();
  return layers.map((layer) => {
    if (layer.kind === "page") return layer;
    const pageNumber = layer.pageNumber;
    const readingOrder =
      pageNumber === undefined
        ? layer.readingOrder
        : readingOrderByPage.get(pageNumber) ?? 0;
    if (pageNumber !== undefined) {
      readingOrderByPage.set(pageNumber, (readingOrder ?? 0) + 1);
    }
    return {
      ...layer,
      zIndex: nextZIndex--,
      ...(readingOrder === undefined ? {} : { readingOrder }),
    };
  });
}

export function moveEditableLayer(
  layers: readonly Layer[],
  sourceId: string,
  targetIndex: number,
): { layers: Layer[]; moved: Layer } | null {
  const sourceIndex = layers.findIndex((layer) => layer.id === sourceId);
  const boundedTargetIndex = Math.max(
    0,
    Math.min(layers.length - 1, targetIndex),
  );
  const source = layers[sourceIndex];
  const target = layers[boundedTargetIndex];
  if (
    !source ||
    !target ||
    sourceIndex === boundedTargetIndex ||
    source.kind === "page" ||
    target.kind === "page"
  ) {
    return null;
  }

  const next = [...layers];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(boundedTargetIndex, 0, moved);
  return { layers: reindexLayerOrder(next), moved };
}

export function arrangeLayersForReading(
  layers: readonly Layer[],
): Layer[] {
  const content = layers
    .filter((layer) => layer.kind !== "page")
    .sort(
      (left, right) =>
        (left.pageNumber ?? 1) - (right.pageNumber ?? 1) ||
        (left.bounds?.y ?? 0) - (right.bounds?.y ?? 0) ||
        (left.direction === "rtl"
          ? (right.bounds?.x ?? 0) - (left.bounds?.x ?? 0)
          : (left.bounds?.x ?? 0) - (right.bounds?.x ?? 0)),
    );
  return reindexLayerOrder([
    ...content,
    ...layers.filter((layer) => layer.kind === "page"),
  ]);
}
