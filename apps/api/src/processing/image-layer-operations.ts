import type {
  ImageGuidanceStroke,
  LayerDocument,
  LayerDocumentEditResult,
  LayerNode,
} from "@motionprep/contracts";
import { MAX_IMAGE_LAYERS } from "@motionprep/contracts";
import {
  applyRasterGuidance,
  MediaProcessingError,
  mergeRasterLayers,
  refineRasterEdges,
} from "@motionprep/media-processing";
import {
  canonicalLayerName,
  createUniqueLayerName,
} from "@motionprep/layer-domain";
import type { ObjectStorage } from "../storage/object-storage.js";
import {
  DocumentEditCoordinator,
  editReplayResult,
  invalidDocumentOperation,
  layerEditRequestHash,
  revisionConflict,
} from "./document-edit-coordinator.js";
import { unionLayerBounds } from "./layer-operation-utils.js";
import { ProcessingDomainError } from "./processing-errors.js";
import { RasterAssetStore } from "./raster-asset-store.js";
import { cleanupRasterAssets } from "./raster-asset-cleanup.js";

export interface RefineImageLayerEdgesInput {
  projectId: string;
  sourceVersionId: string;
  baseRevision: number;
  layerId: string;
  radius: 1 | 2 | 3;
  strength: number;
  actorUserId: string;
  operationId: string;
}

export interface MergeImageLayersInput {
  projectId: string;
  sourceVersionId: string;
  baseRevision: number;
  layerIds: readonly string[];
  actorUserId: string;
  operationId: string;
}

export interface ApplyImageGuidanceResult {
  document: LayerDocument;
  affectedLayerIds: string[];
  createdLayerIds: string[];
  warnings: string[];
  storedKeys: string[];
}

export class ImageLayerOperations {
  constructor(
    private readonly edits: DocumentEditCoordinator,
    private readonly rasterAssets: RasterAssetStore,
    private readonly storage: ObjectStorage,
    private readonly onAssetCleanupError?: (
      error: unknown,
      objectKey: string,
    ) => void,
  ) {}

  async refineEdges(
    input: RefineImageLayerEdgesInput,
  ): Promise<LayerDocumentEditResult> {
    const document = await this.edits.requireDocument(
      input.projectId,
      input.sourceVersionId,
    );
    const requestHash = layerEditRequestHash("image-edge-refine", input);
    const replay = await this.edits.findReplay(
      document,
      input.operationId,
      "image-edge-refine",
      requestHash,
    );
    if (replay) return editReplayResult(replay);
    if ((document.revision ?? 1) !== input.baseRevision) {
      throw revisionConflict();
    }
    if (!document.imagePreparation) {
      throw invalidDocumentOperation("تحسين الحواف متاح لمشروعات الصور فقط.");
    }
    const layer = document.layers.find(
      (candidate) => candidate.id === input.layerId,
    );
    if (
      !layer ||
      layer.kind !== "raster" ||
      layer.locked ||
      layer.fixed ||
      !layer.rasterAsset
    ) {
      throw invalidDocumentOperation(
        "اختر طبقة Raster غير مقفلة قبل تحسين الحواف.",
      );
    }
    const object = await this.rasterAssets.load(layer.rasterAsset);
    if (!object) {
      throw new ProcessingDomainError(
        "LAYER_ASSET_NOT_FOUND",
        "تعذر تحميل أصل طبقة Raster أو التحقق من سلامته.",
      );
    }
    let refined: Buffer;
    try {
      refined = await refineRasterEdges(object.body, {
        radius: input.radius,
        strength: input.strength,
      });
    } catch (error) {
      if (error instanceof MediaProcessingError) {
        throw invalidDocumentOperation(error.message);
      }
      throw error;
    }

    const targetRevision = (document.revision ?? 1) + 1;
    const reference = await this.rasterAssets.storeTool(
      document,
      targetRevision,
      "edge-refine",
      layer.id,
      input.operationId,
      refined,
    );
    try {
      const changed = {
        ...document,
        layers: document.layers.map((candidate) =>
          candidate.id === layer.id
            ? { ...candidate, rasterAsset: reference }
            : candidate,
        ),
      };
      const details = {
        affectedLayerIds: [layer.id],
        createdLayerIds: [],
        removedLayerIds: [],
      };
      const updated = await this.edits.save(
        document,
        changed,
        "image-edge-refine",
        input.actorUserId,
        input.operationId,
        details,
        "image",
        requestHash,
      );
      return { document: updated, ...details };
    } catch (error) {
      await this.cleanupAsset(reference.objectKey);
      throw error;
    }
  }

  async merge(
    input: MergeImageLayersInput,
  ): Promise<LayerDocumentEditResult> {
    const document = await this.edits.requireDocument(
      input.projectId,
      input.sourceVersionId,
    );
    const requestHash = layerEditRequestHash("image-merge", input);
    const replay = await this.edits.findReplay(
      document,
      input.operationId,
      "image-merge",
      requestHash,
    );
    if (replay) return editReplayResult(replay);
    if ((document.revision ?? 1) !== input.baseRevision) {
      throw revisionConflict();
    }
    if (!document.imagePreparation) {
      throw invalidDocumentOperation("دمج Raster متاح لمشروعات الصور فقط.");
    }
    const uniqueIds = [...new Set(input.layerIds)];
    if (uniqueIds.length < 2 || uniqueIds.length > MAX_IMAGE_LAYERS) {
      throw invalidDocumentOperation(
        `اختر من طبقتين إلى ${MAX_IMAGE_LAYERS} طبقة Raster للدمج.`,
      );
    }
    const selected = uniqueIds.map((id) =>
      document.layers.find((layer) => layer.id === id),
    );
    if (
      selected.some(
        (layer) =>
          !layer ||
          layer.kind !== "raster" ||
          layer.locked ||
          layer.fixed ||
          !layer.visible ||
          !layer.bounds ||
          !layer.rasterAsset,
      )
    ) {
      throw invalidDocumentOperation(
        "يجب أن تكون كل الطبقات المحددة Raster ظاهرة وغير مقفلة ولها أصول وحدود.",
      );
    }
    const rasterLayers = selected as Array<
      LayerNode & {
        bounds: NonNullable<LayerNode["bounds"]>;
        rasterAsset: NonNullable<LayerNode["rasterAsset"]>;
      }
    >;
    if (
      rasterLayers.some(
        (layer) => layer.parentId !== rasterLayers[0]!.parentId,
      )
    ) {
      throw invalidDocumentOperation(
        "لا يمكن دمج طبقات Raster من مجموعات مختلفة.",
      );
    }
    const stored = await Promise.all(
      rasterLayers.map(async (layer) => {
        const object = await this.rasterAssets.load(layer.rasterAsset);
        if (!object) {
          throw new ProcessingDomainError(
            "LAYER_ASSET_NOT_FOUND",
            "أحد أصول Raster المحددة غير متاح.",
          );
        }
        return { layer, object };
      }),
    );
    const bounds = unionLayerBounds(rasterLayers.map((layer) => layer.bounds));
    let mergedBody: Buffer;
    try {
      mergedBody = await mergeRasterLayers({
        bounds,
        layers: stored.map(({ layer, object }) => ({
          source: object.body,
          bounds: layer.bounds,
          opacity: layer.opacity,
          zIndex: layer.zIndex,
        })),
      });
    } catch (error) {
      if (error instanceof MediaProcessingError) {
        throw invalidDocumentOperation(error.message);
      }
      throw error;
    }

    const mergedId = crypto.randomUUID();
    const targetRevision = (document.revision ?? 1) + 1;
    const reference = await this.rasterAssets.storeTool(
      document,
      targetRevision,
      "merge",
      mergedId,
      input.operationId,
      mergedBody,
    );
    try {
      const removed = new Set(uniqueIds);
      const siblingNames = new Set(
        document.layers
          .filter(
            (layer) =>
              !removed.has(layer.id) &&
              layer.parentId === rasterLayers[0]!.parentId,
          )
          .map((layer) => canonicalLayerName(layer.name)),
      );
      const mergedLayer: LayerNode = {
        ...rasterLayers[0]!,
        id: mergedId,
        name: createUniqueLayerName(`merged_${targetRevision}`, siblingNames),
        visible: true,
        locked: false,
        fixed: false,
        opacity: 1,
        zIndex: Math.max(...rasterLayers.map((layer) => layer.zIndex)),
        confidence: Math.min(
          ...rasterLayers.map((layer) => layer.confidence ?? 1),
        ),
        bounds,
        rasterAsset: reference,
      };
      const layers = [
        ...document.layers.filter((layer) => !removed.has(layer.id)),
        mergedLayer,
      ];
      const changed: LayerDocument = {
        ...document,
        layers,
        imagePreparation: {
          ...document.imagePreparation,
          outputLayers: layers.filter((layer) => layer.kind === "raster").length,
        },
      };
      const details = {
        affectedLayerIds: uniqueIds,
        createdLayerIds: [mergedId],
        removedLayerIds: uniqueIds,
      };
      const updated = await this.edits.save(
        document,
        changed,
        "image-merge",
        input.actorUserId,
        input.operationId,
        details,
        "image",
        requestHash,
      );
      return { document: updated, ...details };
    } catch (error) {
      await this.cleanupAsset(reference.objectKey);
      throw error;
    }
  }

  private cleanupAsset(objectKey: string): Promise<void> {
    return cleanupRasterAssets(
      this.storage,
      [objectKey],
      this.onAssetCleanupError,
    );
  }

  async applyGuidance(
    document: LayerDocument,
    strokes: readonly ImageGuidanceStroke[],
    targetRevision: number,
    operationId: string,
  ): Promise<ApplyImageGuidanceResult> {
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
    const separateTargets = [...byLayer.values()].filter((strokesForLayer) =>
      strokesForLayer.some((stroke) => stroke.kind === "separate"),
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
      const object = await this.rasterAssets.load(layer.rasterAsset);
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

      const refinedReference = await this.rasterAssets.storeGuided(
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
        const separatedReference = await this.rasterAssets.storeGuided(
          document,
          targetRevision,
          separatedId,
          "separated",
          operationId,
          applied.separated,
        );
        storedKeys.push(separatedReference.objectKey);
        const currentLayer = layers.find(
          (candidate) => candidate.id === layerId,
        )!;
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
}
