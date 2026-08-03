import type { LayerDocument, LayerNode } from "@motionprep/contracts";
import {
  writePsdBuffer,
  type Layer as PsdLayer,
  type Psd,
} from "ag-psd";
import sharp from "sharp";

import {
  assertDocumentDimensions,
  MAX_DECODED_PIXELS,
} from "./document-dimensions.js";
import { ExportAdapterError } from "./export-adapter-error.js";
import {
  clampOpacity,
  createPsdImageResources,
  pixelData,
  withScaledAlpha,
} from "./psd-buffer.js";

export { ExportAdapterError } from "./export-adapter-error.js";
export { createPdfDocumentPsd, createPdfPagePsd } from "./pdf-psd.js";

const TIFF_TOTAL_PIXEL_BUDGET = 32_000_000;

export interface RasterLayerAsset {
  layer: LayerNode;
  source: Buffer;
}

export interface TransparentPng {
  layerId: string;
  filename: string;
  body: Buffer;
}

interface PreparedRaster {
  layer: LayerNode;
  pixels: Buffer;
  width: number;
  height: number;
  left: number;
  top: number;
}

/**
 * Writes a standards-shaped RGB/8-bit PSD with real raster layers. Adobe
 * application compatibility is deliberately a separate Golden Test gate.
 */
export async function createRasterPsd(
  document: LayerDocument,
  assets: readonly RasterLayerAsset[],
): Promise<Buffer> {
  assertDocumentDimensions(document, true);
  const prepared = await prepareRasterAssets(document, assets);
  const composite = await createComposite(document, prepared);
  const psd: Psd = {
    width: document.width,
    height: document.height,
    imageData: pixelData(composite, document.width, document.height),
    children: prepared
      .slice()
      .sort((left, right) => right.layer.zIndex - left.layer.zIndex)
      .map(toPsdLayer),
    imageResources: createPsdImageResources(),
  };

  return writePsdBuffer(psd, {
    generateThumbnail: false,
    noBackground: true,
    trimImageData: false,
  });
}

/**
 * Produces one full-canvas RGBA PNG per raster layer so every file shares the
 * same origin when imported into animation software.
 */
export async function createTransparentPngs(
  document: LayerDocument,
  assets: readonly RasterLayerAsset[],
): Promise<TransparentPng[]> {
  assertDocumentDimensions(document, false);
  const prepared = await prepareRasterAssets(document, assets);

  return Promise.all(
    prepared
      .slice()
      .sort((left, right) => left.layer.zIndex - right.layer.zIndex)
      .map(async (item, index) => {
        const body = await fullCanvas(document, item)
          .png({ compressionLevel: 9, adaptiveFiltering: true })
          .toBuffer();

        return {
          layerId: item.layer.id,
          filename: `${String(index + 1).padStart(2, "0")}_${safeFilename(
            item.layer.name,
          )}.png`,
          body,
        };
      }),
  );
}

/**
 * Produces a multi-page TIFF where every page is one full-canvas raster layer.
 * TIFF does not have one portable cross-application layer model, so pages are
 * used deliberately and PSD remains the primary Adobe interchange format.
 */
export async function createLayeredTiff(
  document: LayerDocument,
  assets: readonly RasterLayerAsset[],
): Promise<Buffer> {
  assertDocumentDimensions(document, false);
  const prepared = (await prepareRasterAssets(document, assets))
    .slice()
    .sort((left, right) => right.layer.zIndex - left.layer.zIndex);
  if (prepared.length === 0) {
    throw new ExportAdapterError(
      "RASTER_LAYER_REQUIRED",
      "The image document does not contain raster layers for TIFF export.",
    );
  }
  if (
    document.width * document.height * Math.max(1, prepared.length) >
    TIFF_TOTAL_PIXEL_BUDGET
  ) {
    throw new ExportAdapterError(
      "TIFF_PIXEL_BUDGET_EXCEEDED",
      "The multi-page TIFF exceeds the safe memory budget; use PSD or PNG ZIP.",
    );
  }
  const pages = await Promise.all(
    prepared.map((item) =>
      fullCanvas(document, item).raw().toBuffer(),
    ),
  );
  return sharp(Buffer.concat(pages), {
    raw: {
      width: document.width,
      height: document.height * prepared.length,
      channels: 4,
      pageHeight: document.height,
    },
  })
    .tiff({
      compression: "lzw",
      predictor: "horizontal",
      resolutionUnit: "inch",
      xres: 72 / 25.4,
      yres: 72 / 25.4,
    })
    .toBuffer();
}

async function prepareRasterAssets(
  document: LayerDocument,
  assets: readonly RasterLayerAsset[],
): Promise<PreparedRaster[]> {
  if (assets.length === 0) {
    throw new ExportAdapterError(
      "RASTER_LAYER_REQUIRED",
      "لا توجد طبقة Raster قابلة للتصدير.",
    );
  }

  const seen = new Set<string>();
  const prepared: PreparedRaster[] = [];
  for (const asset of assets) {
    if (asset.layer.kind !== "raster" || seen.has(asset.layer.id)) {
      throw new ExportAdapterError(
        "RASTER_ASSET_MISMATCH",
        "كل أصل صورة يجب أن يرتبط بطبقة Raster فريدة.",
      );
    }
    seen.add(asset.layer.id);

    let decoded: {
      data: Buffer;
      info: { width: number; height: number };
    };
    try {
      decoded = await sharp(asset.source, {
        failOn: "error",
        limitInputPixels: MAX_DECODED_PIXELS,
      })
        .toColourspace("srgb")
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new ExportAdapterError(
        "RASTER_DECODE_FAILED",
        `تعذر فك ترميز أصل الطبقة ${asset.layer.name}.`,
      );
    }

    const placement = resolvePlacement(document, asset.layer, decoded.info);
    prepared.push({
      layer: asset.layer,
      pixels: decoded.data,
      width: decoded.info.width,
      height: decoded.info.height,
      ...placement,
    });
  }
  return prepared;
}

function fullCanvas(document: LayerDocument, item: PreparedRaster) {
  return transparentCanvas(document.width, document.height).composite([
    {
      input: item.pixels,
      raw: {
        width: item.width,
        height: item.height,
        channels: 4,
      },
      left: item.left,
      top: item.top,
    },
  ]);
}

function transparentCanvas(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
}

function resolvePlacement(
  document: LayerDocument,
  layer: LayerNode,
  decoded: { width: number; height: number },
): { left: number; top: number } {
  if (
    decoded.width === document.width &&
    decoded.height === document.height
  ) {
    return { left: 0, top: 0 };
  }

  const bounds = layer.bounds;
  if (!bounds) {
    throw new ExportAdapterError(
      "RASTER_ASSET_MISMATCH",
      `أبعاد أصل الطبقة ${layer.name} لا تطابق مساحة العمل ولا تحمل موضعًا صالحًا.`,
    );
  }
  const left = Math.round(bounds.x);
  const top = Math.round(bounds.y);
  const width = Math.round(bounds.width);
  const height = Math.round(bounds.height);
  if (
    left < 0 ||
    top < 0 ||
    width !== decoded.width ||
    height !== decoded.height ||
    left + width > document.width ||
    top + height > document.height
  ) {
    throw new ExportAdapterError(
      "RASTER_ASSET_MISMATCH",
      `موضع أو أبعاد أصل الطبقة ${layer.name} غير صالحة لمساحة العمل.`,
    );
  }
  return { left, top };
}

async function createComposite(
  document: LayerDocument,
  assets: readonly PreparedRaster[],
): Promise<Buffer> {
  const visible = assets
    .filter((item) => item.layer.visible && item.layer.opacity > 0)
    .slice()
    .sort((left, right) => left.layer.zIndex - right.layer.zIndex);

  const inputs = visible.map((item) => {
    const pixels =
      item.layer.opacity < 1
        ? withScaledAlpha(item.pixels, item.layer.opacity)
        : item.pixels;
    return {
      input: pixels,
      raw: {
        width: item.width,
        height: item.height,
        channels: 4 as const,
      },
      left: item.left,
      top: item.top,
    };
  });

  return transparentCanvas(document.width, document.height)
    .composite(inputs)
    .raw()
    .toBuffer();
}

function toPsdLayer(item: PreparedRaster): PsdLayer {
  return {
    name: item.layer.name,
    top: item.top,
    left: item.left,
    opacity: clampOpacity(item.layer.opacity),
    hidden: !item.layer.visible,
    blendMode: "normal",
    protected: {
      position: item.layer.locked || item.layer.fixed,
      composite: item.layer.locked || item.layer.fixed,
      transparency: item.layer.locked || item.layer.fixed,
    },
    imageData: pixelData(item.pixels, item.width, item.height),
  };
}


function safeFilename(name: string): string {
  const normalized = name
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/gu, "")
    .replace(/[\\/:*?"<>|]/gu, "-")
    .replace(/\s+/gu, "_")
    .slice(0, 100);
  return normalized || "+layer";
}
