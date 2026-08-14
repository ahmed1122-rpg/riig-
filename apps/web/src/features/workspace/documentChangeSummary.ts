import type { LayerDocumentView } from "../../lib/api";
import type { Layer } from "../../types";

export interface DocumentChangeSummary {
  id: number;
  label: string;
  revision: number | undefined;
  beforeCount: number;
  afterCount: number;
  added: string[];
  removed: string[];
  modified: string[];
}

export type RecordDocumentChange = (
  label: string,
  before: readonly Layer[],
  after: LayerDocumentView,
) => void;

export function summarizeDocumentChange(
  id: number,
  label: string,
  before: readonly Layer[],
  after: LayerDocumentView,
): DocumentChangeSummary {
  const beforeById = new Map(before.map((layer) => [layer.id, layer]));
  const afterById = new Map(after.layers.map((layer) => [layer.id, layer]));
  const added = after.layers
    .filter((layer) => !beforeById.has(layer.id))
    .map((layer) => layer.name);
  const removed = before
    .filter((layer) => !afterById.has(layer.id))
    .map((layer) => layer.name);
  const modified = after.layers.flatMap((layer) => {
    const previous = beforeById.get(layer.id);
    return previous && layerChanged(previous, layer) ? [layer.name] : [];
  });
  return {
    id,
    label,
    revision: after.revision,
    beforeCount: before.length,
    afterCount: after.layers.length,
    added,
    removed,
    modified,
  };
}

function layerChanged(
  before: Layer,
  after: LayerDocumentView["layers"][number],
): boolean {
  return (
    before.parentId !== after.parentId ||
    before.name !== after.name ||
    workspaceKind(before) !== after.kind ||
    before.visible !== after.visible ||
    before.locked !== after.locked ||
    Boolean(before.fixed) !== after.fixed ||
    before.opacity !== Math.round(after.opacity * 100) ||
    before.zIndex !== after.zIndex ||
    before.pageNumber !== after.pageNumber ||
    before.readingOrder !== after.readingOrder ||
    before.direction !== after.direction ||
    before.textAlign !== after.textAlign ||
    before.fontFamily !== after.fontFamily ||
    before.fontSize !== after.fontSize ||
    before.fullContent !== after.fullText ||
    JSON.stringify(before.bounds) !== JSON.stringify(after.bounds)
  );
}

function workspaceKind(layer: Layer): "group" | "text" | "raster" {
  if (layer.kind === "group") return "group";
  if (layer.kind === "text") return "text";
  return "raster";
}
