import {
  MAX_IMAGE_LAYERS,
  type LayerDocument,
  type ProjectKind,
} from "@motionprep/contracts";

export interface LayerPreset {
  id: string;
  version: number;
  labelAr: string;
  projectKind: "image" | "book";
  namePrefix: "+";
  maxLayers: number | null;
  requiredLayerPatterns: readonly string[];
  exportFormats: readonly ("psd" | "png-json" | "txt" | "csv")[];
}

export const builtInPresets = {
  characterBasic: {
    id: "character-basic",
    version: 1,
    labelAr: "شخصية — إعداد أساسي",
    projectKind: "image",
    namePrefix: "+",
    maxLayers: 15,
    requiredLayerPatterns: ["head", "body"],
    exportFormats: ["psd", "png-json"],
  },
  kineticWords: {
    id: "kinetic-words",
    version: 1,
    labelAr: "كتاب متحرك — كلمات",
    projectKind: "book",
    namePrefix: "+",
    maxLayers: null,
    requiredLayerPatterns: [],
    exportFormats: ["psd", "png-json", "txt", "csv"],
  },
  kineticLines: {
    id: "kinetic-lines",
    version: 1,
    labelAr: "كتاب متحرك — أسطر",
    projectKind: "book",
    namePrefix: "+",
    maxLayers: null,
    requiredLayerPatterns: [],
    exportFormats: ["psd", "png-json", "txt", "csv"],
  },
} as const satisfies Record<string, LayerPreset>;

export function normalizeLayerName(rawName: string): `+${string}` {
  const normalized = rawName
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\\/]/g, "-")
    .trim()
    .slice(0, 120);

  const withoutPrefix = normalized.replace(/^\++/, "");
  return `+${withoutPrefix || "layer"}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).slice(0, 6);
}

export function createPdfBackgroundLayerName(pageNumber: number): `+${string}` {
  const safePage = Math.max(1, Math.trunc(pageNumber));
  return `+page_${safePage.toString().padStart(3, "0")}_background`;
}

export function createPdfTextLayerName(
  fullText: string,
  kind: "heading" | "topic" | "sentence" | "line" | "word" | "character",
): `+${string}` {
  const readable = fullText
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\\/:+*?"<>|]/g, " ")
    .trim()
    .replace(/\s+/g, "_");

  const semantic = kind === "character" ? `حرف_${readable}` : readable;
  if (semantic.length <= 60) {
    return normalizeLayerName(semantic);
  }

  return normalizeLayerName(`${semantic.slice(0, 53)}_${stableHash(fullText)}`);
}

export interface ProductionIssue {
  code:
    | "IMAGE_LAYER_LIMIT_EXCEEDED"
    | "IMAGE_RASTER_ASSET_MISSING"
    | "IMAGE_RASTER_ASSET_DUPLICATE"
    | "IMAGE_RASTER_BOUNDS_INVALID"
    | "INVALID_LAYER_PREFIX"
    | "PDF_BACKGROUND_MISSING"
    | "PDF_BACKGROUND_NOT_FIXED";
  message: string;
  layerId?: string;
  pageNumber?: number;
}

export function validateProductionDocument(
  document: LayerDocument,
  projectKind: ProjectKind,
): ProductionIssue[] {
  const issues: ProductionIssue[] = [];
  const contentLayers = document.layers.filter((layer) => layer.kind !== "group");

  if (projectKind === "image" && contentLayers.length > MAX_IMAGE_LAYERS) {
    issues.push({
      code: "IMAGE_LAYER_LIMIT_EXCEEDED",
      message: `Image assets may contain at most ${MAX_IMAGE_LAYERS} layers.`,
    });
  }

  if (projectKind === "image" && document.imagePreparation) {
    const objectKeys = new Set<string>();
    for (const layer of document.layers.filter(
      (candidate) => candidate.kind === "raster",
    )) {
      if (!layer.rasterAsset) {
        issues.push({
          code: "IMAGE_RASTER_ASSET_MISSING",
          message: "Every prepared raster layer requires a stored asset.",
          layerId: layer.id,
        });
        continue;
      }
      if (objectKeys.has(layer.rasterAsset.objectKey)) {
        issues.push({
          code: "IMAGE_RASTER_ASSET_DUPLICATE",
          message: "Raster layers must not share the same stored asset.",
          layerId: layer.id,
        });
      }
      objectKeys.add(layer.rasterAsset.objectKey);

      const bounds = layer.bounds;
      if (
        bounds &&
        (!Number.isSafeInteger(bounds.x) ||
          !Number.isSafeInteger(bounds.y) ||
          !Number.isSafeInteger(bounds.width) ||
          !Number.isSafeInteger(bounds.height) ||
          bounds.x < 0 ||
          bounds.y < 0 ||
          bounds.width <= 0 ||
          bounds.height <= 0 ||
          bounds.x + bounds.width > document.width ||
          bounds.y + bounds.height > document.height)
      ) {
        issues.push({
          code: "IMAGE_RASTER_BOUNDS_INVALID",
          message: "Raster layer bounds must fit inside the document canvas.",
          layerId: layer.id,
        });
      }
    }
  }

  for (const layer of document.layers) {
    if (!layer.name.startsWith("+") || layer.name.startsWith("++")) {
      issues.push({
        code: "INVALID_LAYER_PREFIX",
        message: "Every layer name must begin with exactly one plus sign.",
        layerId: layer.id,
      });
    }
  }

  if (projectKind === "book") {
    const pages = new Set([
      ...(document.pages?.map((page) => page.pageNumber) ?? []),
      ...document.layers.flatMap((layer) =>
        layer.pageNumber === undefined ? [] : [layer.pageNumber],
      ),
    ]);

    for (const pageNumber of pages) {
      const expectedName = createPdfBackgroundLayerName(pageNumber);
      const backgrounds = document.layers.filter(
        (layer) => layer.pageNumber === pageNumber && layer.name === expectedName,
      );

      if (backgrounds.length !== 1) {
        issues.push({
          code: "PDF_BACKGROUND_MISSING",
          message: "Each PDF page requires exactly one white background layer.",
          pageNumber,
        });
        continue;
      }

      const background = backgrounds[0];
      if (!background?.fixed || !background.locked) {
        issues.push({
          code: "PDF_BACKGROUND_NOT_FIXED",
          message: "The PDF page background must be fixed and locked.",
          ...(background ? { layerId: background.id } : {}),
          pageNumber,
        });
      }
    }
  }

  return issues;
}
