import {
  ApiError,
  getProjectLayerDocument,
  getLayerRasterAsset,
  type LayerDocumentView,
  type ProjectSummary,
} from "../../lib/api";
import { layerLayoutMetadata } from "@motionprep/contracts";
import type { Layer, ProjectMode } from "../../types";
import type { PreviewQuality } from "./PreviewToolbar";

export function storedPreviewQuality(): PreviewQuality {
  try {
    const stored = window.localStorage.getItem(
      "motionprep.settings.preview-quality",
    );
    return stored !== null && JSON.parse(stored) === "full"
      ? "full"
      : "fast";
  } catch {
    return "fast";
  }
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
        Number(left.fixed) - Number(right.fixed) ||
        (left.readingOrder ?? Number.MAX_SAFE_INTEGER) -
          (right.readingOrder ?? Number.MAX_SAFE_INTEGER) ||
        right.zIndex - left.zIndex,
  );
  return orderedLayers.map((layer, index) => ({
    id: layer.id,
    name: layer.name,
    kind:
      layer.kind === "text"
        ? "text"
        : mode === "book" && layer.fixed
          ? "page"
          : "body",
    visible: layer.visible,
    locked: layer.locked,
    opacity: Math.round(layer.opacity * 100),
    zIndex: layer.zIndex,
    ...(layer.confidence === undefined
      ? {}
      : { confidence: Math.round(layer.confidence * 100) }),
    color: ["#3bb3a9", "#6887d8", "#9c72cb"][index % 3]!,
    ...(previewUrlsByLayer.has(layer.id)
      ? { previewUrl: previewUrlsByLayer.get(layer.id)! }
      : {}),
    ...(layer.fullText ? { fullContent: layer.fullText } : {}),
    ...layerLayoutMetadata(layer),
  }));
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
