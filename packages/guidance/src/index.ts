import {
  MAX_IMAGE_LAYERS,
  type ImageGuidanceKind,
  type ImageGuidanceStroke,
  type LayerBounds,
  type LayerDocument,
  type LayerNode,
  type NormalizedPoint,
  type PdfMarkerKind,
  type PdfMarkerRegion,
} from "@motionprep/contracts";
import {
  canonicalLayerName,
  createUniqueLayerName,
  isPdfPageRootGroup,
  layerNameScopeKey,
} from "@motionprep/layer-domain";

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function normalizePoint(x: number, y: number): NormalizedPoint {
  return { x: clamp(x), y: clamp(y) };
}

export function createImageGuidanceStroke(input: {
  id: string;
  targetLayerId: string | null;
  kind: ImageGuidanceKind;
  brushSize: number;
  points: NormalizedPoint[];
  createdAt?: string;
}): ImageGuidanceStroke {
  if (input.points.length < 2) {
    throw new Error("GUIDANCE_STROKE_TOO_SHORT");
  }

  return {
    id: input.id,
    targetLayerId: input.targetLayerId,
    kind: input.kind,
    brushSize: Math.min(80, Math.max(2, Math.round(input.brushSize))),
    points: input.points.map((point) => normalizePoint(point.x, point.y)),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function createPdfMarkerRegion(input: {
  id: string;
  pageNumber: number;
  kind: PdfMarkerKind;
  start: NormalizedPoint;
  end: NormalizedPoint;
  readingOrder?: number | null;
  createdAt?: string;
}): PdfMarkerRegion {
  const start = normalizePoint(
    Math.min(input.start.x, input.end.x),
    Math.min(input.start.y, input.end.y),
  );
  const end = normalizePoint(
    Math.max(input.start.x, input.end.x),
    Math.max(input.start.y, input.end.y),
  );

  if (end.x - start.x < 0.005 || end.y - start.y < 0.005) {
    throw new Error("PDF_MARKER_REGION_TOO_SMALL");
  }

  return {
    id: input.id,
    pageNumber: Math.max(1, Math.trunc(input.pageNumber)),
    kind: input.kind,
    start,
    end,
    readingOrder: input.readingOrder ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function guidanceBounds(
  points: NormalizedPoint[],
  margin = 0.03,
): { x: number; y: number; width: number; height: number } | null {
  if (points.length === 0) {
    return null;
  }

  const xs = points.map((point) => clamp(point.x));
  const ys = points.map((point) => clamp(point.y));
  const left = clamp(Math.min(...xs) - margin);
  const top = clamp(Math.min(...ys) - margin);
  const right = clamp(Math.max(...xs) + margin);
  const bottom = clamp(Math.max(...ys) + margin);

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function canCreateSeparateImageLayer(currentLayerCount: number): boolean {
  return currentLayerCount < MAX_IMAGE_LAYERS;
}

export interface AppliedPdfGuidance {
  document: LayerDocument;
  affectedLayerIds: string[];
  createdLayerIds: string[];
  warnings: string[];
}

/**
 * Applies PDF marker regions to the existing text-layer graph. The operation
 * never modifies or unlocks the required white page background.
 */
export function applyPdfMarkerRegions(
  document: LayerDocument,
  regions: readonly PdfMarkerRegion[],
): AppliedPdfGuidance {
  const pages = new Map(
    (document.pages ?? []).map((page) => [page.pageNumber, page]),
  );
  let layers = [...document.layers];
  const affected = new Set<string>();
  const created: string[] = [];
  const warnings: string[] = [];

  for (const region of regions) {
    const page = pages.get(region.pageNumber);
    if (!page) {
      warnings.push(`region:${region.id}:page_not_found`);
      continue;
    }
    const bounds: LayerBounds = {
      x: region.start.x * page.width,
      y: region.start.y * page.height,
      width: (region.end.x - region.start.x) * page.width,
      height: (region.end.y - region.start.y) * page.height,
    };
    const matching = layers.filter(
      (layer) =>
        layer.kind === "text" &&
        !layer.fixed &&
        !layer.locked &&
        layer.pageNumber === region.pageNumber &&
        layer.bounds &&
        overlapsMeaningfully(layer.bounds, bounds),
    );
    if (matching.length === 0) {
      warnings.push(`region:${region.id}:no_text_layers`);
      continue;
    }
    matching.forEach((layer) => affected.add(layer.id));

    if (region.kind === "ignore") {
      const ids = new Set(matching.map((layer) => layer.id));
      layers = layers.map((layer) =>
        ids.has(layer.id) ? { ...layer, visible: false } : layer,
      );
      continue;
    }

    const groupId = `guide-${region.id}`;
    if (layers.some((layer) => layer.id === groupId)) {
      warnings.push(`region:${region.id}:already_applied`);
      continue;
    }
    const pageGroupId = layers.find(
      (layer) =>
        layer.pageNumber === region.pageNumber &&
        isPdfPageRootGroup(layer),
    )?.id ?? null;
    const usedNames = new Set(
      layers
        .filter((layer) =>
          layerNameScopeKey(layer) ===
          `${region.pageNumber}:${pageGroupId ?? "root"}`,
        )
        .map((layer) => canonicalLayerName(layer.name)),
    );
    const group: LayerNode = {
      id: groupId,
      parentId: pageGroupId,
      kind: "group",
      name: createUniqueLayerName(
        `+${region.kind}_${String(
          region.readingOrder ?? created.length + 1,
        ).padStart(3, "0")}`,
        usedNames,
      ),
      visible: true,
      locked: false,
      opacity: 1,
      fixed: false,
      zIndex: Math.max(...matching.map((layer) => layer.zIndex), 0),
      pageNumber: region.pageNumber,
      bounds,
      ...(region.readingOrder === null
        ? {}
        : { readingOrder: region.readingOrder }),
    };
    const ids = new Set(matching.map((layer) => layer.id));
    layers = [
      ...layers.map((layer) =>
        ids.has(layer.id) ? { ...layer, parentId: groupId } : layer,
      ),
      group,
    ];
    created.push(groupId);
  }

  layers = pruneEmptyGroups(layers);
  const retainedIds = new Set(layers.map((layer) => layer.id));

  return {
    document: { ...document, layers },
    affectedLayerIds: [...affected],
    createdLayerIds: created.filter((id) => retainedIds.has(id)),
    warnings,
  };
}

function pruneEmptyGroups(layers: readonly LayerNode[]): LayerNode[] {
  let current = [...layers];
  while (true) {
    const parentIds = new Set(
      current.flatMap((layer) => (layer.parentId ? [layer.parentId] : [])),
    );
    const next = current.filter(
      (layer) => layer.kind !== "group" || layer.fixed || parentIds.has(layer.id),
    );
    if (next.length === current.length) return next;
    current = next;
  }
}

function overlapsMeaningfully(
  layer: LayerBounds,
  region: LayerBounds,
): boolean {
  const left = Math.max(layer.x, region.x);
  const top = Math.max(layer.y, region.y);
  const right = Math.min(layer.x + layer.width, region.x + region.width);
  const bottom = Math.min(layer.y + layer.height, region.y + region.height);
  if (right <= left || bottom <= top) return false;
  const intersection = (right - left) * (bottom - top);
  const layerArea = Math.max(1, layer.width * layer.height);
  const centerX = layer.x + layer.width / 2;
  const centerY = layer.y + layer.height / 2;
  const centerInside =
    centerX >= region.x &&
    centerX <= region.x + region.width &&
    centerY >= region.y &&
    centerY <= region.y + region.height;
  return centerInside || intersection / layerArea >= 0.15;
}
