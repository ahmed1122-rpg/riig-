import type { LayerNode } from "@motionprep/contracts";

export interface MergeEligibility {
  allowed: boolean;
  reason?:
    | "COUNT"
    | "MISSING"
    | "KIND"
    | "PROTECTED"
    | "CONTENT"
    | "PAGE"
    | "PARENT"
    | "DIRECTION"
    | "ALIGNMENT";
}

export function canMergeTextLayers(
  layers: readonly LayerNode[],
  layerIds: readonly string[],
): MergeEligibility {
  if (layerIds.length < 2 || layerIds.length > 50) return { allowed: false, reason: "COUNT" };
  const selected = selectLayers(layers, layerIds);
  if (!selected) return { allowed: false, reason: "MISSING" };
  if (selected.some((layer) => layer.kind !== "text")) return { allowed: false, reason: "KIND" };
  if (selected.some((layer) => layer.fixed || layer.locked)) return { allowed: false, reason: "PROTECTED" };
  if (!same(selected, (layer) => layer.pageNumber ?? null)) return { allowed: false, reason: "PAGE" };
  if (!same(selected, (layer) => layer.parentId)) return { allowed: false, reason: "PARENT" };
  if (!same(selected, (layer) => layer.direction ?? "rtl")) return { allowed: false, reason: "DIRECTION" };
  if (!same(selected, (layer) => layer.textAlign ?? "start")) {
    return { allowed: false, reason: "ALIGNMENT" };
  }
  if (selected.some((layer) => !layer.fullText || !layer.bounds)) return { allowed: false, reason: "CONTENT" };
  return { allowed: true };
}

export function canMergeRasterLayers(
  layers: readonly LayerNode[],
  layerIds: readonly string[],
  maxLayers = 15,
): MergeEligibility {
  if (layerIds.length < 2 || layerIds.length > maxLayers) return { allowed: false, reason: "COUNT" };
  const selected = selectLayers(layers, layerIds);
  if (!selected) return { allowed: false, reason: "MISSING" };
  if (selected.some((layer) => layer.kind !== "raster")) return { allowed: false, reason: "KIND" };
  if (selected.some((layer) => layer.fixed || layer.locked)) return { allowed: false, reason: "PROTECTED" };
  if (!same(selected, (layer) => layer.parentId)) return { allowed: false, reason: "PARENT" };
  return { allowed: true };
}

function selectLayers(layers: readonly LayerNode[], ids: readonly string[]): LayerNode[] | null {
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) return null;
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const selected = ids.map((id) => byId.get(id));
  return selected.every((layer): layer is LayerNode => layer !== undefined) ? selected : null;
}

function same<T>(layers: readonly LayerNode[], value: (layer: LayerNode) => T): boolean {
  const first = layers[0];
  return first !== undefined && layers.every((layer) => value(layer) === value(first));
}
