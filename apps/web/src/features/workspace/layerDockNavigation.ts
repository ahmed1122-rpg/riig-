import type { Layer, ProjectMode } from "../../types";

type LayerDirection = "previous" | "next" | "first" | "last";

function focusLayerRow(root: ParentNode, layerId: string) {
  const rows = root.querySelectorAll<HTMLElement>(
    ".pro-layer-row[data-layer-id]",
  );
  [...rows].find((row) => row.dataset.layerId === layerId)?.focus();
}

export function navigateLayerSelection({
  layers,
  layerId,
  direction,
  onSelectionChange,
}: {
  layers: readonly Layer[];
  layerId: string;
  direction: LayerDirection;
  onSelectionChange: (ids: string[], activeId: string) => void;
}) {
  const current = layers.findIndex((layer) => layer.id === layerId);
  if (current < 0 || layers.length === 0) return;
  const targetIndex =
    direction === "first"
      ? 0
      : direction === "last"
        ? layers.length - 1
        : Math.max(
            0,
            Math.min(
              layers.length - 1,
              current + (direction === "previous" ? -1 : 1),
            ),
          );
  const target = layers[targetIndex];
  if (!target || target.id === layerId) return;
  onSelectionChange([target.id], target.id);
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => focusLayerRow(document, target.id)),
  );
}

export async function openLayerDiagnostic({
  layerId,
  layers,
  mode,
  activePdfPage,
  dock,
  onPdfPageChange,
  onSelectionChange,
  onActiveLayerChange,
  onOpenLayers,
}: {
  layerId: string;
  layers: readonly Layer[];
  mode: ProjectMode;
  activePdfPage: number;
  dock: HTMLElement | null;
  onPdfPageChange: (pageNumber: number) => Promise<boolean>;
  onSelectionChange: (ids: string[], activeId: string) => void;
  onActiveLayerChange: (layerId: string) => void;
  onOpenLayers: () => void;
}) {
  const layer = layers.find((candidate) => candidate.id === layerId);
  if (!layer) return;
  if (
    mode === "book" &&
    layer.pageNumber !== undefined &&
    layer.pageNumber !== activePdfPage &&
    !(await onPdfPageChange(layer.pageNumber))
  ) {
    return;
  }
  onSelectionChange([layer.id], layer.id);
  onActiveLayerChange(layer.id);
  onOpenLayers();
  window.requestAnimationFrame(() => {
    if (dock) focusLayerRow(dock, layer.id);
  });
}
