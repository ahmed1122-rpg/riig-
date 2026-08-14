import type { Layer } from "../../types";

export interface LayerReviewUpdate {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  zIndex: number;
  readingOrder?: number;
  bounds?: NonNullable<Layer["bounds"]>;
  direction?: NonNullable<Layer["direction"]>;
  textAlign?: NonNullable<Layer["textAlign"]>;
  fontFamily?: string;
  fontSize?: number;
  fullText?: string;
}

export type LayerReviewSnapshot = ReadonlyMap<string, string>;

function isStructural(layer: Layer): boolean {
  return layer.kind === "page" || layer.kind === "group" || Boolean(layer.fixed);
}

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
    layer.kind === "group" || layer.fixed || snapshot.get(layer.id) === signature(layer)
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
            ...(layer.bounds ? { bounds: layer.bounds } : {}),
            ...(layer.direction ? { direction: layer.direction } : {}),
            ...(layer.textAlign ? { textAlign: layer.textAlign } : {}),
            ...(layer.fontFamily ? { fontFamily: layer.fontFamily } : {}),
            ...(layer.fontSize === undefined
              ? {}
              : { fontSize: layer.fontSize }),
            ...(layer.kind === "text" && layer.fullContent !== undefined
              ? { fullText: layer.fullContent }
              : {}),
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
    layer.bounds ?? null,
    layer.direction ?? null,
    layer.textAlign ?? null,
    layer.fontFamily ?? null,
    layer.fontSize ?? null,
    layer.fullContent ?? null,
  ]);
}

export function reindexLayerOrder(layers: readonly Layer[]): Layer[] {
  const editableCount = layers.filter((layer) => !isStructural(layer)).length;
  let nextZIndex = editableCount;
  const readingOrderByScope = new Map<string, number>();
  return layers.map((layer) => {
    if (isStructural(layer)) return layer;
    const pageNumber = layer.pageNumber;
    const scope = `${pageNumber ?? 1}:${layer.parentId ?? "root"}`;
    const readingOrder =
      pageNumber === undefined
        ? layer.readingOrder
        : readingOrderByScope.get(scope) ?? 0;
    if (pageNumber !== undefined) {
      readingOrderByScope.set(scope, (readingOrder ?? 0) + 1);
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
    isStructural(source) ||
    isStructural(target) ||
    (source.pageNumber ?? 1) !== (target.pageNumber ?? 1) ||
    (source.parentId ?? null) !== (target.parentId ?? null)
  ) {
    return null;
  }

  const next = [...layers];
  const [moved] = next.splice(sourceIndex, 1);
  if (!moved) return null;
  next.splice(boundedTargetIndex, 0, moved);
  return { layers: reindexLayerOrder(next), moved };
}

export function arrangeLayersForReading(
  layers: readonly Layer[],
): Layer[] {
  const content = layers
    .filter((layer) => !isStructural(layer))
    .sort(
      (left, right) =>
        (left.pageNumber ?? 1) - (right.pageNumber ?? 1) ||
        (left.bounds?.y ?? 0) - (right.bounds?.y ?? 0) ||
        (left.direction === "rtl"
          ? (right.bounds?.x ?? 0) - (left.bounds?.x ?? 0)
          : (left.bounds?.x ?? 0) - (right.bounds?.x ?? 0)),
    );
  const contentIds = new Set(content.map((layer) => layer.id));
  let contentIndex = 0;
  return reindexLayerOrder(
    layers.map((layer) =>
      contentIds.has(layer.id) ? content[contentIndex++]! : layer,
    ),
  );
}
