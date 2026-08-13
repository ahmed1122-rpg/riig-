import type {
  LayerDocument,
  LayerDocumentCommand,
  LayerCommandScope,
  LayerNode,
} from "@motionprep/contracts";
import { normalizeDocumentLayerNames } from "./naming.js";

export interface AppliedLayerCommand {
  document: LayerDocument;
  affectedLayerIds: string[];
}

export function applyLayerDocumentCommand(
  document: LayerDocument,
  command: LayerDocumentCommand,
): AppliedLayerCommand {
  if (command.kind === "move-layer") {
    return moveLayer(document, command);
  }
  const selectedIds = resolveScope(document.layers, command.scope);
  if (selectedIds.size > 5_000) throw new RangeError("A layer command may affect at most 5,000 layers.");
  if (command.kind === "normalize-names") {
    return normalizeDocumentLayerNames(document, selectedIds);
  }
  if (command.kind === "update-state") {
    return updateLayerState(document, selectedIds, command);
  }
  return arrangeLayerOrder(document, selectedIds, command.order);
}

function moveLayer(
  document: LayerDocument,
  command: Extract<LayerDocumentCommand, { kind: "move-layer" }>,
): AppliedLayerCommand {
  const sourceIndex = document.layers.findIndex((layer) => layer.id === command.layerId);
  const targetIndex = document.layers.findIndex((layer) => layer.id === command.targetLayerId);
  const source = document.layers[sourceIndex];
  const target = document.layers[targetIndex];
  if (
    !source ||
    !target ||
    source.id === target.id ||
    source.kind === "group" ||
    target.kind === "group" ||
    source.fixed ||
    target.fixed ||
    source.locked ||
    target.locked ||
    source.parentId !== target.parentId ||
    (source.pageNumber ?? null) !== (target.pageNumber ?? null) ||
    document.layers
      .slice(Math.min(sourceIndex, targetIndex), Math.max(sourceIndex, targetIndex) + 1)
      .some((layer) => layer.locked && !layer.fixed)
  ) {
    throw new RangeError("Layers may only move between editable siblings in the same page folder.");
  }
  const layers = [...document.layers];
  layers.splice(sourceIndex, 1);
  const refreshedTarget = layers.findIndex((layer) => layer.id === target.id);
  layers.splice(refreshedTarget + (command.position === "after" ? 1 : 0), 0, source);
  return {
    document: { ...document, layers: reindex(layers) },
    affectedLayerIds: [source.id, target.id],
  };
}

export function resolveScope(
  layers: readonly LayerNode[],
  scope: LayerCommandScope,
): Set<string> {
  if (scope.kind === "document") return new Set(layers.map((layer) => layer.id));
  if (scope.kind === "page") return new Set(layers.filter((layer) => layer.pageNumber === scope.pageNumber).map((layer) => layer.id));
  if (scope.kind === "parent") return new Set(layers.filter((layer) => layer.parentId === scope.parentId).map((layer) => layer.id));
  return new Set(scope.layerIds);
}

function updateLayerState(
  document: LayerDocument,
  selectedIds: ReadonlySet<string>,
  command: Extract<LayerDocumentCommand, { kind: "update-state" }>,
): AppliedLayerCommand {
  const affectedLayerIds: string[] = [];
  const layers = document.layers.map((layer) => {
    if (!selectedIds.has(layer.id) || layer.fixed || layer.kind === "group") return layer;
    const changed =
      (command.visible !== undefined && command.visible !== layer.visible) ||
      (command.locked !== undefined && command.locked !== layer.locked);
    if (!changed) return layer;
    affectedLayerIds.push(layer.id);
    return {
      ...layer,
      ...(command.visible === undefined ? {} : { visible: command.visible }),
      ...(command.locked === undefined ? {} : { locked: command.locked }),
    };
  });
  return { document: { ...document, layers }, affectedLayerIds };
}

function arrangeLayerOrder(
  document: LayerDocument,
  selectedIds: ReadonlySet<string>,
  order: "reading" | "reverse",
): AppliedLayerCommand {
  const byScope = new Map<string, LayerNode[]>();
  for (const layer of document.layers) {
    if (
      layer.kind === "group" ||
      layer.fixed ||
      layer.locked ||
      !selectedIds.has(layer.id)
    ) continue;
    const key = `${layer.pageNumber ?? "document"}:${layer.parentId ?? "root"}`;
    const siblings = byScope.get(key) ?? [];
    siblings.push(layer);
    byScope.set(key, siblings);
  }
  const replacements = new Map<string, LayerNode[]>();
  const affectedLayerIds: string[] = [];
  for (const [scope, siblings] of byScope) {
    const ordered = order === "reverse" ? [...siblings].reverse() : [...siblings].sort(compareReadingOrder);
    replacements.set(scope, ordered);
    if (ordered.some((layer, index) => layer.id !== siblings[index]?.id)) {
      affectedLayerIds.push(...ordered.map((layer) => layer.id));
    }
  }
  const reordered = document.layers.map((layer) => {
    if (
      layer.kind === "group" ||
      layer.fixed ||
      layer.locked ||
      !selectedIds.has(layer.id)
    ) return layer;
    const key = `${layer.pageNumber ?? "document"}:${layer.parentId ?? "root"}`;
    return replacements.get(key)?.shift() ?? layer;
  });
  return {
    document: { ...document, layers: reindex(reordered) },
    affectedLayerIds: [...new Set(affectedLayerIds)],
  };
}

function compareReadingOrder(left: LayerNode, right: LayerNode): number {
  return (
    (left.bounds?.y ?? 0) - (right.bounds?.y ?? 0) ||
    (left.direction === "rtl"
      ? (right.bounds?.x ?? 0) - (left.bounds?.x ?? 0)
      : (left.bounds?.x ?? 0) - (right.bounds?.x ?? 0)) ||
    left.id.localeCompare(right.id)
  );
}

function reindex(layers: readonly LayerNode[]): LayerNode[] {
  const contentCount = layers.filter((layer) => layer.kind !== "group").length;
  let zIndex = contentCount;
  const readingByScope = new Map<string, number>();
  return layers.map((layer) => {
    if (layer.kind === "group" || layer.fixed) return layer;
    const scope = `${layer.pageNumber ?? "document"}:${layer.parentId ?? "root"}`;
    const readingOrder = layer.pageNumber === undefined ? layer.readingOrder : readingByScope.get(scope) ?? 0;
    if (layer.pageNumber !== undefined) readingByScope.set(scope, (readingOrder ?? 0) + 1);
    const nextZIndex = zIndex--;
    if (layer.locked) return layer;
    return {
      ...layer,
      zIndex: nextZIndex,
      ...(readingOrder === undefined ? {} : { readingOrder }),
    };
  });
}
