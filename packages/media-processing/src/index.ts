import { createHash } from "node:crypto";
import {
  MAX_IMAGE_LAYERS,
  type LayerBounds,
  type LayerDocument,
  type LayerNode,
  type RasterAssetReference,
} from "@motionprep/contracts";
import sharp from "sharp";
import {
  MediaProcessingError,
  type PrepareImageInput,
  type PreparedImageSource,
  type PreparedRasterAsset,
} from "./media-processing-types.js";
import {
  alphaAt,
  decodeRgba,
  forEachNeighbor,
} from "./raster-pixels.js";

export * from "./media-processing-types.js";
export { applyRasterGuidance } from "./raster-guidance.js";
export { refineRasterEdges } from "./edge-refinement.js";
export { mergeRasterLayers } from "./raster-merge.js";
export type {
  RasterEdgeRefinementOptions,
} from "./edge-refinement.js";
export type { RasterMergeInput } from "./raster-merge.js";

const SEGMENTATION_PIXEL_BUDGET = 16_777_216;
const BOUNDS_WORK_BUDGET_MULTIPLIER = 4;
const LAST_EXACT_COMPONENT_LABEL = 65_534;
const OVERFLOW_COMPONENT_LABEL = 65_535;
const COMPONENT_CORE_ALPHA = 16;

/**
 * Produces independently stored raster assets when transparency exposes
 * disconnected foreground components. Opaque inputs remain one honest source
 * layer; semantic/AI segmentation is intentionally a separate adapter.
 */
export async function prepareImageSource(
  input: PrepareImageInput,
  now: () => Date = () => new Date(),
  createId: () => string = () => crypto.randomUUID(),
): Promise<PreparedImageSource> {
  const decoded = await decodeRgba(
    input.source,
    "تعذر فك ترميز الصورة بأمان.",
  );

  const { width, height } = decoded.info;
  if (!width || !height) {
    throw new MediaProcessingError(
      "IMAGE_DIMENSIONS_MISSING",
      "تعذر تحديد أبعاد الصورة.",
    );
  }

  const pixelCount = width * height;
  const hasTransparency = containsTransparency(decoded.data);
  if (!hasTransparency) {
    return createSingleSourceResult(
      input,
      decoded.data,
      width,
      height,
      "opaque-source",
      now,
      createId,
    );
  }
  if (pixelCount > SEGMENTATION_PIXEL_BUDGET) {
    return createSingleSourceResult(
      input,
      decoded.data,
      width,
      height,
      "pixel-budget",
      now,
      createId,
    );
  }

  const segmentation = labelAlphaComponents(decoded.data, width, height);
  if (segmentation.components.length === 0) {
    throw new MediaProcessingError(
      "IMAGE_HAS_NO_VISIBLE_PIXELS",
      "الصورة شفافة بالكامل ولا تحتوي بكسلات قابلة لإنشاء طبقة.",
    );
  }
  if (segmentation.detectedComponents === 1) {
    return createSingleSourceResult(
      input,
      decoded.data,
      width,
      height,
      "single-component",
      now,
      createId,
    );
  }

  const groups = createOutputGroups(segmentation.components);
  const boundsWork = groups.reduce(
    (sum, group) => sum + group.bounds.width * group.bounds.height,
    0,
  );
  if (boundsWork > pixelCount * BOUNDS_WORK_BUDGET_MULTIPLIER) {
    return createSingleSourceResult(
      input,
      decoded.data,
      width,
      height,
      "bounds-budget",
      now,
      createId,
    );
  }

  const labelToGroup = new Uint8Array(OVERFLOW_COMPONENT_LABEL + 1);
  for (const [groupIndex, group] of groups.entries()) {
    for (const label of group.labels) {
      labelToGroup[label] = groupIndex + 1;
    }
  }

  const layers: LayerNode[] = [];
  const rasterAssets: PreparedRasterAsset[] = [];
  for (const [index, group] of groups.entries()) {
    const layerId = createId();
    const body = await encodeComponentGroup(
      decoded.data,
      segmentation.labels,
      labelToGroup,
      index + 1,
      width,
      group.bounds,
    );
    const reference = createAssetReference(
      input,
      layerId,
      body,
    );
    layers.push({
      id: layerId,
      parentId: null,
      kind: "raster",
      name: group.mergedOverflow
        ? "+تفاصيل_مجمعة"
        : `+جزء_${String(index + 1).padStart(2, "0")}`,
      visible: true,
      locked: false,
      opacity: 1,
      fixed: false,
      zIndex: index,
      confidence: group.mergedOverflow ? 0.75 : 0.99,
      bounds: group.bounds,
      rasterAsset: reference,
    });
    rasterAssets.push({ layerId, ...reference, body });
  }

  return {
    document: createDocument(input, width, height, layers, now, {
      strategy: "alpha-components",
      detectedComponents: segmentation.detectedComponents,
      outputLayers: layers.length,
      overflowMerged: segmentation.detectedComponents > MAX_IMAGE_LAYERS,
    }),
    rasterAssets,
  };
}

interface ComponentStats {
  label: number;
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface ComponentSegmentation {
  labels: Uint16Array;
  components: ComponentStats[];
  detectedComponents: number;
}

function labelAlphaComponents(
  pixels: Buffer,
  width: number,
  height: number,
): ComponentSegmentation {
  const pixelCount = width * height;
  const labels = new Uint16Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const statsByLabel = new Map<number, ComponentStats>();
  let detectedComponents = 0;
  let alphaThreshold = COMPONENT_CORE_ALPHA;
  let hasCorePixels = false;
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if ((pixels[offset] ?? 0) >= COMPONENT_CORE_ALPHA) {
      hasCorePixels = true;
      break;
    }
  }
  if (!hasCorePixels) alphaThreshold = 1;

  for (let seed = 0; seed < pixelCount; seed += 1) {
    if (
      labels[seed] !== 0 ||
      alphaAt(pixels, seed) < alphaThreshold
    ) {
      continue;
    }
    detectedComponents += 1;
    const label =
      detectedComponents <= LAST_EXACT_COMPONENT_LABEL
        ? detectedComponents
        : OVERFLOW_COMPONENT_LABEL;
    let stats = statsByLabel.get(label);
    if (!stats) {
      stats = {
        label,
        area: 0,
        minX: width,
        minY: height,
        maxX: -1,
        maxY: -1,
      };
      statsByLabel.set(label, stats);
    }

    let read = 0;
    let write = 1;
    queue[0] = seed;
    labels[seed] = label;
    while (read < write) {
      const index = queue[read]!;
      read += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      stats.area += 1;
      stats.minX = Math.min(stats.minX, x);
      stats.minY = Math.min(stats.minY, y);
      stats.maxX = Math.max(stats.maxX, x);
      stats.maxY = Math.max(stats.maxY, y);

      forEachNeighbor(x, y, width, height, (neighbor) => {
        if (
          labels[neighbor] === 0 &&
          alphaAt(pixels, neighbor) >= alphaThreshold
        ) {
          labels[neighbor] = label;
          queue[write] = neighbor;
          write += 1;
        }
      });
    }
  }

  if (detectedComponents > 0 && alphaThreshold > 1) {
    let read = 0;
    let write = 0;
    for (let index = 0; index < pixelCount; index += 1) {
      if (labels[index] !== 0) queue[write++] = index;
    }
    while (read < write) {
      const index = queue[read++]!;
      const label = labels[index]!;
      const x = index % width;
      const y = Math.floor(index / width);
      forEachNeighbor(
        x,
        y,
        width,
        height,
        (neighbor, neighborX, neighborY) => {
          if (
            labels[neighbor] !== 0 ||
            alphaAt(pixels, neighbor) === 0
          ) {
            return;
          }
          labels[neighbor] = label;
          queue[write++] = neighbor;
          const stats = statsByLabel.get(label)!;
          stats.area += 1;
          stats.minX = Math.min(stats.minX, neighborX);
          stats.minY = Math.min(stats.minY, neighborY);
          stats.maxX = Math.max(stats.maxX, neighborX);
          stats.maxY = Math.max(stats.maxY, neighborY);
        }
      );
    }
  }

  return {
    labels,
    components: [...statsByLabel.values()],
    detectedComponents,
  };
}

interface OutputGroup {
  labels: number[];
  bounds: LayerBounds;
  mergedOverflow: boolean;
}

function createOutputGroups(
  components: readonly ComponentStats[],
): OutputGroup[] {
  const sorted = components
    .slice()
    .sort(
      (left, right) =>
        right.area - left.area ||
        left.minY - right.minY ||
        left.minX - right.minX,
    );
  if (sorted.length <= MAX_IMAGE_LAYERS) {
    return sorted.map((component) => ({
      labels: [component.label],
      bounds: toBounds(component),
      mergedOverflow: component.label === OVERFLOW_COMPONENT_LABEL,
    }));
  }

  const independent = sorted.slice(0, MAX_IMAGE_LAYERS - 1);
  const residual = sorted.slice(MAX_IMAGE_LAYERS - 1);
  return [
    ...independent.map((component) => ({
      labels: [component.label],
      bounds: toBounds(component),
      mergedOverflow: component.label === OVERFLOW_COMPONENT_LABEL,
    })),
    {
      labels: residual.map((component) => component.label),
      bounds: unionBounds(residual),
      mergedOverflow: true,
    },
  ];
}

async function encodeComponentGroup(
  source: Buffer,
  labels: Uint16Array,
  labelToGroup: Uint8Array,
  group: number,
  sourceWidth: number,
  bounds: LayerBounds,
): Promise<Buffer> {
  const body = Buffer.alloc(bounds.width * bounds.height * 4);
  for (let y = 0; y < bounds.height; y += 1) {
    const sourceY = bounds.y + y;
    for (let x = 0; x < bounds.width; x += 1) {
      const sourceX = bounds.x + x;
      const sourcePixel = sourceY * sourceWidth + sourceX;
      if (labelToGroup[labels[sourcePixel]!] !== group) continue;
      const sourceOffset = sourcePixel * 4;
      const outputOffset = (y * bounds.width + x) * 4;
      source.copy(body, outputOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return sharp(body, {
    raw: {
      width: bounds.width,
      height: bounds.height,
      channels: 4,
    },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function createSingleSourceResult(
  input: PrepareImageInput,
  pixels: Buffer,
  width: number,
  height: number,
  fallbackReason:
    | "opaque-source"
    | "single-component"
    | "pixel-budget"
    | "bounds-budget",
  now: () => Date,
  createId: () => string,
): Promise<PreparedImageSource> {
  const layerId = createId();
  const body = await sharp(pixels, {
    raw: { width, height, channels: 4 },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const reference = createAssetReference(input, layerId, body);
  const layer: LayerNode = {
    id: layerId,
    parentId: null,
    kind: "raster",
    name: "+source",
    visible: true,
    locked: false,
    opacity: 1,
    fixed: false,
    zIndex: 0,
    confidence: 1,
    rasterAsset: reference,
  };
  return {
    document: createDocument(input, width, height, [layer], now, {
      strategy: "single-source",
      detectedComponents: fallbackReason === "single-component" ? 1 : 0,
      outputLayers: 1,
      overflowMerged: false,
      fallbackReason,
    }),
    rasterAssets: [{ layerId, ...reference, body }],
  };
}

function createDocument(
  input: PrepareImageInput,
  width: number,
  height: number,
  layers: LayerNode[],
  now: () => Date,
  imagePreparation: NonNullable<LayerDocument["imagePreparation"]>,
): LayerDocument {
  return {
    schemaVersion: "1.0",
    projectId: input.projectId,
    sourceVersionId: input.sourceVersionId,
    revision: 1,
    generatedAt: now().toISOString(),
    width,
    height,
    colorSpace: "sRGB",
    layers,
    imagePreparation,
  };
}

function createAssetReference(
  input: PrepareImageInput,
  layerId: string,
  body: Buffer,
): RasterAssetReference {
  return {
    objectKey: [
      "derived",
      encodeURIComponent(input.projectId),
      encodeURIComponent(input.sourceVersionId),
      "layers",
      `${encodeURIComponent(layerId)}.png`,
    ].join("/"),
    contentType: "image/png",
    sizeBytes: body.byteLength,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
}

function containsTransparency(pixels: Buffer): boolean {
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset] !== 255) return true;
  }
  return false;
}

function toBounds(component: ComponentStats): LayerBounds {
  return {
    x: component.minX,
    y: component.minY,
    width: component.maxX - component.minX + 1,
    height: component.maxY - component.minY + 1,
  };
}

function unionBounds(components: readonly ComponentStats[]): LayerBounds {
  const minX = Math.min(...components.map((component) => component.minX));
  const minY = Math.min(...components.map((component) => component.minY));
  const maxX = Math.max(...components.map((component) => component.maxX));
  const maxY = Math.max(...components.map((component) => component.maxY));
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}
