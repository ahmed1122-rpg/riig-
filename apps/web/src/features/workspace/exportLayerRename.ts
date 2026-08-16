import { canonicalLayerName, normalizeLayerName } from "@motionprep/layer-domain";
import type { Layer } from "../../types";

export type ExportLayerRenameResult =
  | null
  | false
  | readonly [name: string, layers: Layer[]];

export function renameExportLayer(
  layers: readonly Layer[],
  selected: Layer | undefined,
  draft: string,
  fixedBackground: boolean,
): ExportLayerRenameResult {
  if (!selected || fixedBackground) return null;
  const name = normalizeLayerName(draft);
  const duplicate = layers.some(
    (layer) =>
      layer.id !== selected.id &&
      (layer.pageNumber ?? 1) === (selected.pageNumber ?? 1) &&
      (layer.parentId ?? null) === (selected.parentId ?? null) &&
      canonicalLayerName(layer.name) === canonicalLayerName(name),
  );
  if (duplicate) return false;
  return [
    name,
    layers.map((layer) =>
      layer.id === selected.id ? { ...layer, name } : layer,
    ),
  ];
}
