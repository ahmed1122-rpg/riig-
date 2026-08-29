import type {
  ImageGuidanceStroke,
  LayerDocument,
} from "@motionprep/contracts";
import { MAX_IMAGE_LAYERS } from "@motionprep/contracts";
import { applyRasterGuidance } from "@motionprep/media-processing";
import {
  canonicalLayerName,
  createUniqueLayerName,
} from "@motionprep/layer-domain";
import { ProcessingDomainError } from "./processing-errors.js";
import type { RasterAssetStore } from "./raster-asset-store.js";

export interface ApplyImageGuidanceResult {
  document: LayerDocument;
  affectedLayerIds: string[];
  createdLayerIds: string[];
  warnings: string[];
  storedKeys: string[];
}

export async function applyImageGuidance(
  rasterAssets: RasterAssetStore,
  document: LayerDocument,
  strokes: readonly ImageGuidanceStroke[],
  targetRevision: number,
  operationId: string,
): Promise<ApplyImageGuidanceResult> {
  const byLayer = groupStrokesByLayer(strokes);
  assertImageLayerCapacity(document, byLayer);

  let layers = [...document.layers];
  const affectedLayerIds: string[] = [];
  const createdLayerIds: string[] = [];
  const warnings: string[] = [];
  const storedKeys: string[] = [];
  for (const [layerId, layerStrokes] of byLayer) {
    const layer = layers.find((candidate) => candidate.id === layerId);
    if (
      !layer ||
      layer.kind !== "raster" ||
      layer.locked ||
      layer.fixed ||
      !layer.rasterAsset
    ) {
      throw new ProcessingDomainError(
        "GUIDANCE_LAYER_UNAVAILABLE",
        "الطبقة المستهدفة غير موجودة أو مقفلة أو لا تحمل أصل Raster.",
      );
    }
    const object = await rasterAssets.load(layer.rasterAsset);
    if (!object) {
      throw new ProcessingDomainError(
        "LAYER_ASSET_NOT_FOUND",
        "أصل الطبقة المستهدفة غير متاح في التخزين.",
      );
    }
    const applied = await applyRasterGuidance({
      source: object.body,
      documentWidth: document.width,
      documentHeight: document.height,
      ...(layer.bounds ? { layerBounds: layer.bounds } : {}),
      strokes: layerStrokes,
      autoFillPolicy: "review",
    });
    warnings.push(...applied.warnings.map((warning) => `${layerId}:${warning}`));
    affectedLayerIds.push(layerId);
    if (!applied.changed) continue;

    const refinedReference = await rasterAssets.storeGuided(
      document,
      targetRevision,
      layerId,
      "refined",
      operationId,
      applied.refined,
    );
    storedKeys.push(refinedReference.objectKey);
    layers = layers.map((candidate) =>
      candidate.id === layerId
        ? { ...candidate, rasterAsset: refinedReference }
        : candidate,
    );
    if (applied.separated) {
      const separatedId = crypto.randomUUID();
      const separatedReference = await rasterAssets.storeGuided(
        document,
        targetRevision,
        separatedId,
        "separated",
        operationId,
        applied.separated,
      );
      storedKeys.push(separatedReference.objectKey);
      const currentLayer = layers.find((candidate) => candidate.id === layerId)!;
      const usedNames = new Set(
        layers
          .filter((candidate) => candidate.parentId === currentLayer.parentId)
          .map((candidate) => canonicalLayerName(candidate.name)),
      );
      layers.push({
        ...currentLayer,
        id: separatedId,
        name: createUniqueLayerName(
          `+separated_${String(createdLayerIds.length + 1).padStart(2, "0")}`,
          usedNames,
        ),
        locked: false,
        fixed: false,
        zIndex: Math.max(...layers.map((candidate) => candidate.zIndex), 0) + 1,
        confidence: 1,
        rasterAsset: separatedReference,
      });
      createdLayerIds.push(separatedId);
    }
  }
  return {
    document: { ...document, layers },
    affectedLayerIds,
    createdLayerIds,
    warnings,
    storedKeys,
  };
}

function groupStrokesByLayer(
  strokes: readonly ImageGuidanceStroke[],
): Map<string, ImageGuidanceStroke[]> {
  const byLayer = new Map<string, ImageGuidanceStroke[]>();
  for (const stroke of strokes) {
    if (!stroke.targetLayerId) {
      throw new ProcessingDomainError(
        "GUIDANCE_LAYER_UNAVAILABLE",
        "يجب اختيار طبقة Raster مستهدفة لكل ضربة قلم.",
      );
    }
    const list = byLayer.get(stroke.targetLayerId) ?? [];
    list.push(stroke);
    byLayer.set(stroke.targetLayerId, list);
  }
  return byLayer;
}

function assertImageLayerCapacity(
  document: LayerDocument,
  byLayer: ReadonlyMap<string, readonly ImageGuidanceStroke[]>,
): void {
  const separateTargets = [...byLayer.values()].filter((strokes) =>
    strokes.some((stroke) => stroke.kind === "separate"),
  ).length;
  const contentLayerCount = document.layers.filter(
    (layer) => layer.kind !== "group",
  ).length;
  if (contentLayerCount + separateTargets > MAX_IMAGE_LAYERS) {
    throw new ProcessingDomainError(
      "IMAGE_LAYER_LIMIT_EXCEEDED",
      `لا يمكن أن تتجاوز الصور ${MAX_IMAGE_LAYERS} طبقة.`,
    );
  }
}
