import type { Layer } from "../../types";
import { isPageLayer } from "./workspaceLayerKinds";

export function firstEditableWorkspaceLayer(
  layers: readonly Layer[],
): Layer | undefined {
  return (
    layers.find((layer) => layer.kind === "text") ??
    layers.find((layer) => layer.kind !== "group" && !isPageLayer(layer)) ??
    layers.find(isPageLayer)
  );
}

export function firstEditableWorkspaceLayerId(
  layers: readonly Layer[],
): string {
  return firstEditableWorkspaceLayer(layers)?.id ?? "";
}
