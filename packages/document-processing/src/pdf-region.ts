import type { LayerBounds, NormalizedPoint } from "@motionprep/contracts";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DocumentProcessingError } from "./document-processing-error.js";
import { clamp } from "./pdf-layout.js";
import { deterministicPdfJsOptions } from "./pdfjs-options.js";
import {
  assertPdfPageGeometry,
  assertRenderSurface,
  boundedOcrRenderScale,
} from "./pdf-geometry.js";

const OCR_TARGET_LONG_EDGE = 1_600;

export interface RenderPdfRegionInput {
  source: Buffer;
  pageNumber: number;
  start: NormalizedPoint;
  end: NormalizedPoint;
}

export interface RenderedPdfRegion {
  image: Buffer;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  bounds: LayerBounds;
  renderScale: number;
}

/** Renders only the selected PDF rectangle for bounded regional OCR. */
export async function renderPdfRegion(
  input: RenderPdfRegionInput,
): Promise<RenderedPdfRegion> {
  const left = clamp(Math.min(input.start.x, input.end.x), 0, 1);
  const top = clamp(Math.min(input.start.y, input.end.y), 0, 1);
  const right = clamp(Math.max(input.start.x, input.end.x), 0, 1);
  const bottom = clamp(Math.max(input.start.y, input.end.y), 0, 1);
  if (
    !Number.isSafeInteger(input.pageNumber) ||
    input.pageNumber < 1 ||
    right - left < 0.005 ||
    bottom - top < 0.005
  ) {
    throw new DocumentProcessingError(
      "PDF_DECODE_FAILED",
      "The requested PDF OCR region is invalid.",
    );
  }

  const loadingTask = getDocument({
    data: new Uint8Array(input.source),
    ...deterministicPdfJsOptions,
  });
  let pdf: Awaited<typeof loadingTask.promise>;
  try {
    pdf = await loadingTask.promise;
  } catch {
    await loadingTask.destroy();
    throw new DocumentProcessingError(
      "PDF_DECODE_FAILED",
      "The PDF could not be decoded for regional OCR.",
    );
  }

  try {
    if (input.pageNumber > pdf.numPages) {
      throw new DocumentProcessingError(
        "PDF_DECODE_FAILED",
        "The requested PDF page does not exist.",
        [input.pageNumber],
      );
    }
    const page = await pdf.getPage(input.pageNumber);
    try {
      const pageViewport = page.getViewport({ scale: 1 });
      const pageWidth = pageViewport.width;
      const pageHeight = pageViewport.height;
      assertPdfPageGeometry(pageWidth, pageHeight, input.pageNumber);
      const bounds: LayerBounds = {
        x: left * pageWidth,
        y: top * pageHeight,
        width: (right - left) * pageWidth,
        height: (bottom - top) * pageHeight,
      };
      const renderScale = boundedOcrRenderScale({
        width: bounds.width,
        height: bounds.height,
        pageNumber: input.pageNumber,
        targetScale: 4,
        targetLongEdge: OCR_TARGET_LONG_EDGE,
        maxScale: 4,
      });
      const viewport = page.getViewport({ scale: renderScale });
      const cropLeft = Math.floor(left * viewport.width);
      const cropTop = Math.floor(top * viewport.height);
      const cropRight = Math.ceil(right * viewport.width);
      const cropBottom = Math.ceil(bottom * viewport.height);
      const canvasWidth = cropRight - cropLeft;
      const canvasHeight = cropBottom - cropTop;
      assertRenderSurface(canvasWidth, canvasHeight, input.pageNumber);
      const canvas = createCanvas(canvasWidth, canvasHeight);
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        viewport,
        transform: [1, 0, 0, 1, -cropLeft, -cropTop],
        background: "#ffffff",
      }).promise;
      return {
        image: await canvas.encode("png"),
        pageNumber: input.pageNumber,
        pageWidth,
        pageHeight,
        bounds,
        renderScale,
      };
    } finally {
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
}
