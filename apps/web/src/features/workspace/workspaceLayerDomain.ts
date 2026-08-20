import type { LayerNode } from "@motionprep/contracts";
import type { Layer } from "../../types";

export function toDomainLayer(layer: Layer): LayerNode {
  return {
    id: layer.id,
    parentId: layer.parentId ?? null,
    kind: layer.kind,
    name: layer.name as `+${string}`,
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity / 100,
    fixed: layer.fixed ?? false,
    zIndex: layer.zIndex ?? 0,
    ...(layer.fullText ? { fullText: layer.fullText } : {}),
    ...(layer.pageNumber === undefined ? {} : { pageNumber: layer.pageNumber }),
    ...(layer.bounds ? { bounds: layer.bounds } : {}),
    ...(layer.direction ? { direction: layer.direction } : {}),
    ...(layer.textAlign ? { textAlign: layer.textAlign } : {}),
    ...(layer.readingOrder === undefined
      ? {}
      : { readingOrder: layer.readingOrder }),
    ...(layer.fontFamily ? { fontFamily: layer.fontFamily } : {}),
    ...(layer.fontSize === undefined ? {} : { fontSize: layer.fontSize }),
  };
}
