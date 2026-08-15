import type { Layer } from "../../types";
import { contentLayers } from "./layerPageScope";

export type LayerFilter =
  | "all"
  | "visible"
  | "hidden"
  | "locked"
  | "text"
  | "raster"
  | "low-confidence";

const layerFilters = new Set<LayerFilter>([
  "all",
  "visible",
  "hidden",
  "locked",
  "text",
  "raster",
  "low-confidence",
]);

export function isLayerFilter(value: unknown): value is LayerFilter {
  return typeof value === "string" && layerFilters.has(value as LayerFilter);
}

export function matchesLayerFilter(
  layer: Layer,
  search: string,
  filter: LayerFilter,
): boolean {
  const normalizedSearch = search.trim().toLocaleLowerCase("ar");
  const matchesSearch =
    !normalizedSearch ||
    layer.name.toLocaleLowerCase("ar").includes(normalizedSearch) ||
    layer.fullText?.toLocaleLowerCase("ar").includes(normalizedSearch);
  const matchesFilter =
    filter === "all" ||
    (filter === "visible" && layer.visible) ||
    (filter === "hidden" && !layer.visible) ||
    (filter === "locked" && layer.locked) ||
    (filter === "text" && layer.kind === "text") ||
    (filter === "raster" && !["text", "page", "group"].includes(layer.kind)) ||
    (filter === "low-confidence" && typeof layer.confidence === "number" && layer.confidence < 90);
  return layer.kind !== "group" && Boolean(matchesSearch && matchesFilter);
}

export function duplicateLayerIds(
  layers: readonly Layer[],
  pageScoped: boolean,
): ReadonlySet<string> {
  const key = (layer: Layer) =>
    JSON.stringify([
      pageScoped ? (layer.pageNumber ?? 1) : null,
      layer.parentId ?? null,
      layer.name,
    ]);
  const counts = new Map<string, number>();
  contentLayers(layers).forEach((layer) =>
    counts.set(key(layer), (counts.get(key(layer)) ?? 0) + 1),
  );
  return new Set(
    contentLayers(layers)
      .filter((layer) => (counts.get(key(layer)) ?? 0) > 1)
      .map((layer) => layer.id),
  );
}
