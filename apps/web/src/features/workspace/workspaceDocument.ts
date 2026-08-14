import {
  ApiError,
  getProjectLayerDocument,
  getLayerRasterAsset,
  type LayerDocumentView,
  type ProjectSummary,
} from "../../lib/api";
import { layerLayoutMetadata } from "@motionprep/contracts";
import type { Layer, ProjectMode } from "../../types";

const LAYER_COLORS = [
  "#3bb3a9",
  "#6887d8",
  "#9c72cb",
  "#d97745",
  "#c85372",
  "#4c9b6e",
] as const;

export function stableLayerColor(layerId: string): string {
  let hash = 0x811c9dc5;
  for (const character of layerId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return LAYER_COLORS[(hash >>> 0) % LAYER_COLORS.length]!;
}

export function isAcceptedFile(
  file: File,
  mode: ProjectMode,
): boolean {
  const extension = file.name.split(".").pop()?.toLocaleLowerCase();
  return mode === "image"
    ? [
        "png",
        "jpg",
        "jpeg",
        "webp",
        "avif",
        "tif",
        "tiff",
        "bmp",
      ].includes(extension ?? "")
    : extension === "pdf";
}

export function toWorkspaceLayers(
  document: LayerDocumentView,
  mode: ProjectMode,
  previewUrlsByLayer: ReadonlyMap<string, string> = new Map(),
): Layer[] {
  const orderedLayers = [...document.layers].sort((left, right) =>
    mode === "image"
      ? right.zIndex - left.zIndex
      : (left.pageNumber ?? 1) - (right.pageNumber ?? 1) ||
        pdfLayerRank(left) - pdfLayerRank(right) ||
        (left.readingOrder ?? Number.MAX_SAFE_INTEGER) -
          (right.readingOrder ?? Number.MAX_SAFE_INTEGER) ||
        right.zIndex - left.zIndex,
  );
  return orderedLayers.map((layer) => ({
    id: layer.id,
    parentId: layer.parentId,
    name: layer.name,
    kind:
      layer.kind === "group"
        ? "group"
        : layer.kind === "text"
        ? "text"
        : mode === "book" && layer.fixed
          ? "page"
          : "body",
    visible: layer.visible,
    locked: layer.locked,
    fixed: layer.fixed,
    opacity: Math.round(layer.opacity * 100),
    zIndex: layer.zIndex,
    ...(layer.confidence === undefined
      ? {}
      : { confidence: Math.round(layer.confidence * 100) }),
    color: stableLayerColor(layer.id),
    ...(previewUrlsByLayer.has(layer.id)
      ? { previewUrl: previewUrlsByLayer.get(layer.id)! }
      : {}),
    ...(layer.kind === "raster"
      ? { hasRasterAsset: Boolean(layer.rasterAsset) }
      : {}),
    ...(layer.fullText ? { fullContent: layer.fullText } : {}),
    ...layerLayoutMetadata(layer),
  }));
}

function pdfLayerRank(
  layer: LayerDocumentView["layers"][number],
): number {
  if (layer.kind === "group" && layer.parentId === null) return 0;
  if (layer.kind === "raster" && layer.fixed) return 1;
  if (layer.kind === "group") return 2;
  return 3;
}

export async function loadRasterLayerPreviews(
  projectId: string,
  sourceVersionId: string,
  document: LayerDocumentView,
  signal?: AbortSignal,
) {
  const rasterLayers = document.layers.filter(
    (layer) => layer.kind === "raster" && layer.rasterAsset,
  );
  const previews = new Map<string, string>();
  const urls: string[] = [];
  try {
    await mapWithConcurrency(rasterLayers, 3, async (layer) => {
      const blob = await getLayerRasterAsset(
        projectId,
        sourceVersionId,
        layer.id,
        layer.rasterAsset!.sha256,
        signal,
      );
      if (signal?.aborted) return;
      const url = URL.createObjectURL(blob);
      previews.set(layer.id, url);
      urls.push(url);
    });
  } catch (error) {
    urls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }
  if (signal?.aborted) {
    urls.forEach((url) => URL.revokeObjectURL(url));
    return { previews: new Map<string, string>(), urls: [] };
  }
  return { previews, urls };
}

export async function loadWorkspaceProjectDocument(
  project: Pick<ProjectSummary, "id" | "currentSourceVersionId">,
  mode: ProjectMode,
  signal: AbortSignal,
) {
  const document = await getProjectLayerDocument(
    project.id,
    signal,
    project.currentSourceVersionId ?? undefined,
  );
  if (!document.sourceVersionId) {
    throw new ApiError(
      "SOURCE_NOT_READY",
      "لا يملك هذا المشروع مصدرًا مجهزًا يمكن فتحه.",
      409,
    );
  }

  const previewResult =
    mode === "image"
      ? await loadRasterLayerPreviews(
          project.id,
          document.sourceVersionId,
          document,
          signal,
        )
      : { previews: new Map<string, string>(), urls: [] };

  return {
    document,
    preparedLayers: toWorkspaceLayers(
      document,
      mode,
      previewResult.previews,
    ),
    previewUrls: previewResult.urls,
  };
}

async function mapWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const value = values[nextIndex++];
      if (value !== undefined) await operation(value);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), values.length) },
      worker,
    ),
  );
}
