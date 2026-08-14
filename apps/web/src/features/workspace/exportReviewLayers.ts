import type { Layer } from "../../types";
import { moveEditableLayer } from "./layerReviewState";

export function reviewableExportLayers(layers: readonly Layer[]): Layer[] {
  return layers.filter((layer) => layer.kind !== "group");
}

export function selectedExportLayer(
  layers: readonly Layer[],
  selectedLayerId: string,
): Layer | undefined {
  return (
    layers.find((layer) => layer.id === selectedLayerId) ??
    layers.find((layer) => layer.kind === "text") ??
    layers[0]
  );
}

export function moveExportLayer(
  allLayers: readonly Layer[],
  reviewableLayers: readonly Layer[],
  selectedId: string,
  direction: -1 | 1,
) {
  const index = reviewableLayers.findIndex((layer) => layer.id === selectedId);
  const target = reviewableLayers[index + direction];
  if (!target) return null;
  return moveEditableLayer(
    allLayers,
    selectedId,
    allLayers.findIndex((layer) => layer.id === target.id),
  );
}
