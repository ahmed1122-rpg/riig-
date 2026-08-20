import type { Layer } from "../../types";

export function resolveLayerSelection(input: {
  layers: readonly Layer[];
  selectedIds: readonly string[];
  anchorId: string;
  targetId: string;
  shiftKey: boolean;
  toggleKey: boolean;
}): string[] {
  if (input.shiftKey) {
    const anchorIndex = input.layers.findIndex(({ id }) => id === input.anchorId);
    const targetIndex = input.layers.findIndex(({ id }) => id === input.targetId);
    const anchor = input.layers[anchorIndex];
    const target = input.layers[targetIndex];
    if (
      !anchor ||
      !target ||
      anchor.kind === "group" ||
      target.kind === "group" ||
      (anchor.pageNumber ?? 1) !== (target.pageNumber ?? 1) ||
      (anchor.parentId ?? null) !== (target.parentId ?? null)
    ) {
      return [input.targetId];
    }
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    return input.layers
      .slice(start, end + 1)
      .filter(
        (layer) =>
          layer.kind !== "group" &&
          (layer.pageNumber ?? 1) === (target.pageNumber ?? 1) &&
          (layer.parentId ?? null) === (target.parentId ?? null),
      )
      .map(({ id }) => id);
  }
  if (input.toggleKey) {
    const next = input.selectedIds.includes(input.targetId)
      ? input.selectedIds.filter((id) => id !== input.targetId)
      : [...input.selectedIds, input.targetId];
    return next.length > 0 ? [...next] : [input.targetId];
  }
  return [input.targetId];
}
