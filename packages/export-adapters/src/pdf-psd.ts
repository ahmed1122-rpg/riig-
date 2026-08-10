import type { LayerDocument, LayerNode } from "@motionprep/contracts";
import { writePsdBuffer, type Layer as PsdLayer, type Psd } from "ag-psd";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { mapWithConcurrency } from "./concurrency.js";
import { assertDocumentDimensions } from "./document-dimensions.js";
import { ExportAdapterError } from "./export-adapter-error.js";
import { preflightPdfPages } from "./pdf-psd-preflight.js";
import {
  clampOpacity,
  createPsdImageResources,
  pixelData,
  withScaledAlpha,
} from "./psd-buffer.js";

const PDF_PAGE_RENDER_CONCURRENCY = 2;
const PDF_TEXT_RENDER_CONCURRENCY = 4;
const PDF_TEXT_FONT = {
  font: "Noto Sans Arabic",
  // Use one complete TTF rather than Unicode-subset webfonts. Mixed Arabic,
  // Latin, and numeric text must never fall back to a host system font.
  fontfile: fileURLToPath(
    import.meta.resolve(
      "@expo-google-fonts/noto-sans-arabic/400Regular/NotoSansArabic_400Regular.ttf",
    ),
  ),
} as const;

interface PreparedPdfText {
  layer: LayerNode;
  pixels: Buffer;
  width: number;
  height: number;
  left: number;
  top: number;
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
  const selectedPages = preflightPdfPages(document, pageNumbers);
  const preparedPages = await mapWithConcurrency(
    selectedPages,
    PDF_PAGE_RENDER_CONCURRENCY,
    (page) => preparePdfPage(document, page.pageNumber),
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
    const pageChildren = [backgroundLayer, ...textLayers];
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
    // PSD stores records bottom-to-top; reverse page groups so Photoshop and
    // After Effects present page 1 before page 2 in their layer panels.
    children: groupPages ? rootChildren.reverse() : rootChildren,
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
      .sort((left, right) => left.layer.zIndex - right.layer.zIndex);
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
    .sort((left, right) => left.zIndex - right.zIndex)
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
    rendered: await mapWithConcurrency(
      textLayers,
      PDF_TEXT_RENDER_CONCURRENCY,
      (layer) => renderPdfTextLayer(layer, width, height),
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
        ...PDF_TEXT_FONT,
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
