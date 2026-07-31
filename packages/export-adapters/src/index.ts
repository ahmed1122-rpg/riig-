import type {
  LayerDocument,
  LayerNode,
} from "@motionprep/contracts";
import {
  writePsdBuffer,
  type Layer as PsdLayer,
  type PixelData,
  type Psd,
} from "ag-psd";
import sharp from "sharp";

const MAX_DECODED_PIXELS = 25_000_000;
const PSD_MAX_DIMENSION = 30_000;
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

interface PreparedPdfText {
  layer: LayerNode;
  pixels: Buffer;
  width: number;
  height: number;
  left: number;
  top: number;
}

export class ExportAdapterError extends Error {
  constructor(
    readonly code:
      | "INVALID_DOCUMENT_DIMENSIONS"
      | "PSD_DIMENSION_LIMIT_EXCEEDED"
      | "TIFF_PIXEL_BUDGET_EXCEEDED"
      | "RASTER_LAYER_REQUIRED"
      | "RASTER_ASSET_MISMATCH"
      | "RASTER_DECODE_FAILED",
    message: string,
  ) {
    super(message);
  }
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

/**
 * Produces a Photoshop-compatible raster PSD for one PDF page. Text remains
 * separated into independently named layers while the white page background
 * is a locked layer. Rasterizing the glyphs avoids missing-font prompts and
 * keeps Arabic shaping deterministic across Adobe installations.
 */
export async function createPdfPagePsd(
  document: LayerDocument,
  pageNumber: number,
): Promise<Buffer> {
  return createPdfPsd(document, [pageNumber], false);
}

/**
 * Produces one PSD containing page groups stacked vertically. Each page keeps
 * its own locked white background and independently named text layers.
 */
export async function createPdfDocumentPsd(
  document: LayerDocument,
): Promise<Buffer> {
  const pageNumbers = (document.pages ?? []).map((page) => page.pageNumber);
  if (pageNumbers.length === 0) {
    throw new ExportAdapterError(
      "INVALID_DOCUMENT_DIMENSIONS",
      "The PDF layer document does not contain any pages.",
    );
  }
  return createPdfPsd(document, pageNumbers, true);
}

interface PreparedPdfPage {
  pageNumber: number;
  width: number;
  height: number;
  background: LayerNode;
  backgroundPixels: Buffer;
  rendered: PreparedPdfText[];
}

async function createPdfPsd(
  document: LayerDocument,
  pageNumbers: readonly number[],
  groupPages: boolean,
): Promise<Buffer> {
  const preparedPages = await Promise.all(
    pageNumbers.map((pageNumber) => preparePdfPage(document, pageNumber)),
  );
  const width = Math.max(...preparedPages.map((page) => page.width));
  const height = preparedPages.reduce((sum, page) => sum + page.height, 0);
  assertDocumentDimensions({ ...document, width, height }, true);

  const compositeInputs: Array<{
    input: Buffer;
    raw: { width: number; height: number; channels: 4 };
    left: number;
    top: number;
  }> = [];
  const rootChildren: PsdLayer[] = [];
  let pageOffset = 0;
  for (const page of preparedPages) {
    const backgroundLayer: PsdLayer = {
      name: page.background.name,
      top: pageOffset,
      left: 0,
      opacity: 1,
      hidden: false,
      blendMode: "normal",
      protected: {
        position: true,
        composite: true,
        transparency: true,
      },
      imageData: pixelData(
        page.backgroundPixels,
        page.width,
        page.height,
      ),
    };
    const textLayers = buildPdfTextLayerTree(
      document,
      page,
      pageOffset,
    );
    const pageChildren = [...textLayers, backgroundLayer];
    if (groupPages) {
      rootChildren.push({
        name: `+page_${String(page.pageNumber).padStart(3, "0")}`,
        opened: false,
        children: pageChildren,
      });
    } else {
      rootChildren.push(...pageChildren);
    }

    compositeInputs.push({
      input: page.backgroundPixels,
      raw: { width: page.width, height: page.height, channels: 4 },
      left: 0,
      top: pageOffset,
    });
    for (const item of page.rendered
      .filter((candidate) => candidate.layer.visible)
      .sort((left, right) => left.layer.zIndex - right.layer.zIndex)) {
      compositeInputs.push({
        input:
          item.layer.opacity < 1
            ? withScaledAlpha(item.pixels, item.layer.opacity)
            : item.pixels,
        raw: { width: item.width, height: item.height, channels: 4 },
        left: item.left,
        top: item.top + pageOffset,
      });
    }
    pageOffset += page.height;
  }

  const composite = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(compositeInputs)
    .raw()
    .toBuffer();
  const psd: Psd = {
    width,
    height,
    imageData: pixelData(composite, width, height),
    children: rootChildren,
    imageResources: createPsdImageResources(),
  };

  return writePsdBuffer(psd, {
    generateThumbnail: false,
    noBackground: false,
    trimImageData: false,
  });
}

function buildPdfTextLayerTree(
  document: LayerDocument,
  page: PreparedPdfPage,
  pageOffset: number,
): PsdLayer[] {
  const groups = document.layers.filter(
    (layer) =>
      layer.kind === "group" &&
      layer.pageNumber === page.pageNumber,
  );
  const knownGroupIds = new Set(groups.map((group) => group.id));
  const groupedTextIds = new Set<string>();
  const entries: Array<{ zIndex: number; psdLayer: PsdLayer }> = [];

  for (const group of groups) {
    const children = page.rendered
      .filter((item) => item.layer.parentId === group.id)
      .sort((left, right) => right.layer.zIndex - left.layer.zIndex);
    if (children.length === 0) continue;
    children.forEach((item) => groupedTextIds.add(item.layer.id));
    entries.push({
      zIndex: group.zIndex,
      psdLayer: {
        name: group.name,
        opened: false,
        hidden: !group.visible,
        opacity: clampOpacity(group.opacity),
        protected: {
          position: group.locked,
          composite: group.locked,
          transparency: group.locked,
        },
        children: children.map((item) =>
          toPdfPsdTextLayer(item, pageOffset),
        ),
      },
    });
  }

  for (const item of page.rendered) {
    if (
      groupedTextIds.has(item.layer.id) ||
      (item.layer.parentId && knownGroupIds.has(item.layer.parentId))
    ) {
      continue;
    }
    entries.push({
      zIndex: item.layer.zIndex,
      psdLayer: toPdfPsdTextLayer(item, pageOffset),
    });
  }
  return entries
    .sort((left, right) => right.zIndex - left.zIndex)
    .map((entry) => entry.psdLayer);
}

function toPdfPsdTextLayer(
  item: PreparedPdfText,
  pageOffset: number,
): PsdLayer {
  return {
    name: item.layer.name,
    top: item.top + pageOffset,
    left: item.left,
    opacity: clampOpacity(item.layer.opacity),
    hidden: !item.layer.visible,
    blendMode: "normal",
    protected: {
      position: item.layer.locked,
      composite: item.layer.locked,
      transparency: item.layer.locked,
    },
    imageData: pixelData(item.pixels, item.width, item.height),
  };
}

async function preparePdfPage(
  document: LayerDocument,
  pageNumber: number,
): Promise<PreparedPdfPage> {
  const page = document.pages?.find(
    (candidate) => candidate.pageNumber === pageNumber,
  );
  if (!page) {
    throw new ExportAdapterError(
      "INVALID_DOCUMENT_DIMENSIONS",
      `PDF page ${pageNumber} is not present in the layer document.`,
    );
  }
  const width = Math.ceil(page.width);
  const height = Math.ceil(page.height);
  assertDocumentDimensions({ ...document, width, height }, true);
  const background = document.layers.find(
    (layer) =>
      layer.pageNumber === pageNumber &&
      layer.kind === "raster" &&
      layer.fillColor === "#ffffff" &&
      layer.fixed,
  );
  if (!background) {
    throw new ExportAdapterError(
      "RASTER_LAYER_REQUIRED",
      `PDF page ${pageNumber} has no locked white background layer.`,
    );
  }
  const textLayers = document.layers
    .filter(
      (layer): layer is LayerNode & {
        fullText: string;
        bounds: NonNullable<LayerNode["bounds"]>;
      } =>
        layer.pageNumber === pageNumber &&
        layer.kind === "text" &&
        Boolean(layer.fullText) &&
        Boolean(layer.bounds),
    )
    .sort((left, right) => left.zIndex - right.zIndex);
  return {
    pageNumber,
    width,
    height,
    background,
    backgroundPixels: Buffer.alloc(width * height * 4, 255),
    rendered: await Promise.all(
      textLayers.map((layer) => renderPdfTextLayer(layer, width, height)),
    ),
  };
}

async function renderPdfTextLayer(
  layer: LayerNode & {
    fullText: string;
    bounds: NonNullable<LayerNode["bounds"]>;
  },
  pageWidth: number,
  pageHeight: number,
): Promise<PreparedPdfText> {
  const left = clampInteger(Math.floor(layer.bounds.x), 0, pageWidth - 1);
  const top = clampInteger(Math.floor(layer.bounds.y), 0, pageHeight - 1);
  const maxWidth = Math.max(
    1,
    Math.min(pageWidth - left, Math.ceil(layer.bounds.width)),
  );
  const maxHeight = Math.max(
    1,
    Math.min(pageHeight - top, Math.ceil(layer.bounds.height)),
  );
  let decoded: {
    data: Buffer;
    info: { width: number; height: number };
  };
  try {
    decoded = await sharp({
      text: {
        text: escapePango(layer.fullText),
        font: "sans",
        width: maxWidth,
        height: maxHeight,
        align: layer.direction === "rtl" ? "right" : "left",
        wrap: "none",
        rgba: true,
      },
    })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new ExportAdapterError(
      "RASTER_DECODE_FAILED",
      `Could not rasterize PDF text layer ${layer.name}.`,
    );
  }

  const alignedLeft =
    layer.direction === "rtl"
      ? Math.max(left, left + maxWidth - decoded.info.width)
      : left;
  return {
    layer,
    pixels: decoded.data,
    width: decoded.info.width,
    height: decoded.info.height,
    left: alignedLeft,
    top,
  };
}

function escapePango(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
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

function createPsdImageResources(): NonNullable<Psd["imageResources"]> {
  return {
    pixelAspectRatio: { aspect: 1 },
    resolutionInfo: {
      horizontalResolution: 72,
      horizontalResolutionUnit: "PPI",
      widthUnit: "Inches",
      verticalResolution: 72,
      verticalResolutionUnit: "PPI",
      heightUnit: "Inches",
    },
  };
}

function pixelData(
  pixels: Uint8Array,
  width: number,
  height: number,
): PixelData {
  return {
    data: Uint8ClampedArray.from(pixels),
    width,
    height,
  };
}

function withScaledAlpha(pixels: Buffer, opacity: number): Buffer {
  const output = Buffer.from(pixels);
  const alphaScale = clampOpacity(opacity);
  for (let index = 3; index < output.length; index += 4) {
    output[index] = Math.round((output[index] ?? 0) * alphaScale);
  }
  return output;
}

function clampOpacity(opacity: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(opacity) ? opacity : 1));
}

function assertDocumentDimensions(
  document: LayerDocument,
  enforcePsdLimit: boolean,
): void {
  const { width, height } = document;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > MAX_DECODED_PIXELS
  ) {
    throw new ExportAdapterError(
      "INVALID_DOCUMENT_DIMENSIONS",
      "أبعاد وثيقة الطبقات غير صالحة أو تتجاوز ميزانية الذاكرة الآمنة.",
    );
  }
  if (
    enforcePsdLimit &&
    (width > PSD_MAX_DIMENSION || height > PSD_MAX_DIMENSION)
  ) {
    throw new ExportAdapterError(
      "PSD_DIMENSION_LIMIT_EXCEEDED",
      `PSD القياسي يدعم أبعادًا حتى ${PSD_MAX_DIMENSION}px لكل محور.`,
    );
  }
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
