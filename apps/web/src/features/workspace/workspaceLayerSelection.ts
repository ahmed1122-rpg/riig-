import type { Layer } from "../../types";

export function firstEditableWorkspaceLayer(
  layers: readonly Layer[],
): Layer | undefined {
  return (
    layers.find((layer) => layer.kind === "text") ??
    layers.find((layer) => layer.kind !== "group" && layer.kind !== "page") ??
    layers.find((layer) => layer.kind === "page")
  );
}

export function firstEditableWorkspaceLayerId(
  layers: readonly Layer[],
): string {
  return firstEditableWorkspaceLayer(layers)?.id ?? "";
}
