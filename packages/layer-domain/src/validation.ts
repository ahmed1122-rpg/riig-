import {
  MAX_IMAGE_LAYERS,
  type LayerDocument,
  type LayerNode,
  type ProductionIssue,
  type ProjectKind,
} from "@motionprep/contracts";
import {
  canonicalLayerName,
  createPdfBackgroundLayerName,
  createPdfPageGroupName,
  isValidLayerName,
  layerNameScopeKey,
} from "./naming.js";

export function validateLayerGraph(document: LayerDocument): ProductionIssue[] {
  const issues: ProductionIssue[] = [];
  const byId = new Map<string, LayerNode>();
  const childCount = new Map<string, number>();
  const namesByScope = new Map<string, Map<string, string>>();

  for (const layer of document.layers) {
    if (byId.has(layer.id)) {
      issues.push(issue("DUPLICATE_LAYER_ID", "Layer identifiers must be unique.", layer));
    } else {
      byId.set(layer.id, layer);
    }
    if (!layer.name.startsWith("+") || layer.name.startsWith("++")) {
      issues.push(issue("INVALID_LAYER_PREFIX", "Every layer name must begin with exactly one plus sign.", layer));
    } else if (!isValidLayerName(layer.name)) {
      issues.push(issue("INVALID_LAYER_NAME", "Layer names must be normalized and safe.", layer));
    }
    validateLayerNumbers(layer, issues);
    const scope = layerNameScopeKey(layer);
    const names = namesByScope.get(scope) ?? new Map<string, string>();
    const canonical = canonicalLayerName(layer.name);
    if (names.has(canonical)) {
      issues.push(issue("DUPLICATE_LAYER_NAME", "Sibling layer names must be unique within their page folder.", layer));
    } else {
      names.set(canonical, layer.id);
    }
    namesByScope.set(scope, names);
    if (layer.parentId) childCount.set(layer.parentId, (childCount.get(layer.parentId) ?? 0) + 1);
  }

  for (const layer of document.layers) {
    if (layer.parentId) {
      const parent = byId.get(layer.parentId);
      if (!parent) {
        issues.push(issue("MISSING_LAYER_PARENT", "Every parent reference must resolve to an existing group.", layer));
      } else if (parent.kind !== "group") {
        issues.push(issue("LAYER_PARENT_NOT_GROUP", "Only group layers may contain child layers.", layer));
      } else if (
        layer.pageNumber !== undefined &&
        parent.pageNumber !== undefined &&
        layer.pageNumber !== parent.pageNumber
      ) {
        issues.push(issue("CROSS_PAGE_PARENT", "A layer cannot belong to a group on another page.", layer));
      }
    }
    if (layer.kind === "group" && (childCount.get(layer.id) ?? 0) === 0) {
      issues.push(issue("EMPTY_LAYER_GROUP", "Layer groups must contain at least one child.", layer));
    }
  }

  detectParentCycles(document.layers, byId, issues);
  return issues;
}

function validateLayerNumbers(
  layer: LayerNode,
  issues: ProductionIssue[],
): void {
  if (
    !Number.isFinite(layer.opacity) ||
    layer.opacity < 0 ||
    layer.opacity > 1
  ) {
    issues.push(issue(
      "LAYER_OPACITY_INVALID",
      "Layer opacity must be a finite number between zero and one.",
      layer,
    ));
  }
  if (
    !Number.isSafeInteger(layer.zIndex) ||
    layer.zIndex < 0 ||
    layer.zIndex > 1_000_000
  ) {
    issues.push(issue(
      "LAYER_Z_INDEX_INVALID",
      "Layer z-index must be a non-negative safe integer no greater than 1,000,000.",
      layer,
    ));
  }
  if (
    layer.readingOrder !== undefined &&
    (
      !Number.isSafeInteger(layer.readingOrder) ||
      layer.readingOrder < 0 ||
      layer.readingOrder > 1_000_000
    )
  ) {
    issues.push(issue(
      "LAYER_READING_ORDER_INVALID",
      "Layer reading order must be a non-negative safe integer no greater than 1,000,000.",
      layer,
    ));
  }
}

function detectParentCycles(
  layers: readonly LayerNode[],
  byId: ReadonlyMap<string, LayerNode>,
  issues: ProductionIssue[],
): void {
  const completed = new Set<string>();
  for (const layer of layers) {
    if (completed.has(layer.id)) continue;
    const visiting = new Map<string, number>();
    let cursor: LayerNode | undefined = layer;
    while (cursor && !completed.has(cursor.id)) {
      if (visiting.has(cursor.id)) {
        issues.push(issue("LAYER_PARENT_CYCLE", "Layer parent references must not contain a cycle.", cursor));
        break;
      }
      visiting.set(cursor.id, visiting.size);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    for (const id of visiting.keys()) completed.add(id);
  }
}

export function validateProductionDocument(
  document: LayerDocument,
  projectKind: ProjectKind,
): ProductionIssue[] {
  const issues = validateLayerGraph(document);
  const contentLayers = document.layers.filter((layer) => layer.kind !== "group");

  if (projectKind === "image" && contentLayers.length > MAX_IMAGE_LAYERS) {
    issues.push({ code: "IMAGE_LAYER_LIMIT_EXCEEDED", message: `Image assets may contain at most ${MAX_IMAGE_LAYERS} layers.` });
  }
  if (projectKind === "image" && document.imagePreparation) validateRasterAssets(document, issues);
  if (projectKind === "book") validatePdfPages(document, issues);
  return issues;
}

function validateRasterAssets(document: LayerDocument, issues: ProductionIssue[]): void {
  const objectKeys = new Set<string>();
  for (const layer of document.layers.filter((candidate) => candidate.kind === "raster")) {
    if (!layer.rasterAsset) {
      issues.push(issue("IMAGE_RASTER_ASSET_MISSING", "Every prepared raster layer requires a stored asset.", layer));
      continue;
    }
    if (objectKeys.has(layer.rasterAsset.objectKey)) {
      issues.push(issue("IMAGE_RASTER_ASSET_DUPLICATE", "Raster layers must not share the same stored asset.", layer));
    }
    objectKeys.add(layer.rasterAsset.objectKey);
    const bounds = layer.bounds;
    if (bounds && (!Number.isSafeInteger(bounds.x) || !Number.isSafeInteger(bounds.y) || !Number.isSafeInteger(bounds.width) || !Number.isSafeInteger(bounds.height) || bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0 || bounds.x + bounds.width > document.width || bounds.y + bounds.height > document.height)) {
      issues.push(issue("IMAGE_RASTER_BOUNDS_INVALID", "Raster layer bounds must fit inside the document canvas.", layer));
    }
  }
}

function validatePdfPages(document: LayerDocument, issues: ProductionIssue[]): void {
  const pages = new Set([
    ...(document.pages?.map((page) => page.pageNumber) ?? []),
    ...document.layers.flatMap((layer) => layer.pageNumber === undefined ? [] : [layer.pageNumber]),
  ]);
  for (const pageNumber of pages) {
    const roots = document.layers.filter((layer) => layer.pageNumber === pageNumber && layer.name === createPdfPageGroupName(pageNumber));
    if (roots.length !== 1) {
      issues.push({ code: "PDF_PAGE_GROUP_MISSING", message: "Each PDF page requires exactly one root page folder.", pageNumber });
      continue;
    }
    const root = roots[0]!;
    if (root.kind !== "group" || root.parentId !== null || !root.fixed || !root.locked) {
      issues.push(issue("PDF_PAGE_GROUP_INVALID", "The PDF page folder must be a fixed, locked root group.", root));
    }
    const backgrounds = document.layers.filter((layer) => layer.pageNumber === pageNumber && layer.name === createPdfBackgroundLayerName(pageNumber) && layer.parentId === root.id);
    if (backgrounds.length !== 1) {
      issues.push({ code: "PDF_BACKGROUND_MISSING", message: "Each PDF page requires exactly one white background layer inside its page folder.", pageNumber });
      continue;
    }
    const background = backgrounds[0]!;
    if (!background.fixed || !background.locked) {
      issues.push(issue("PDF_BACKGROUND_NOT_FIXED", "The PDF page background must be fixed and locked.", background));
    }
  }
}

function issue(
  code: ProductionIssue["code"],
  message: string,
  layer: Pick<LayerNode, "id" | "pageNumber">,
): ProductionIssue {
  return {
    code,
    message,
    layerId: layer.id,
    ...(layer.pageNumber === undefined ? {} : { pageNumber: layer.pageNumber }),
  };
}
