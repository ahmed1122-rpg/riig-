import type { LayerBounds, NormalizedPoint } from "@motionprep/contracts";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DocumentProcessingError } from "./document-processing-error.js";
import { clamp } from "./pdf-layout.js";

const OCR_TARGET_LONG_EDGE = 1_600;
const OCR_MAX_RENDER_PIXELS = 24_000_000;

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
    disableFontFace: true,
    useSystemFonts: false,
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
      const bounds: LayerBounds = {
        x: left * pageWidth,
        y: top * pageHeight,
        width: (right - left) * pageWidth,
        height: (bottom - top) * pageHeight,
      };
      const safePixelScale = Math.sqrt(
        OCR_MAX_RENDER_PIXELS / Math.max(1, bounds.width * bounds.height),
      );
      const targetLongEdgeScale =
        OCR_TARGET_LONG_EDGE / Math.max(1, bounds.width, bounds.height);
      const renderScale = clamp(
        Math.min(4, targetLongEdgeScale, safePixelScale),
        0.25,
        4,
      );
      const viewport = page.getViewport({ scale: renderScale });
      const cropLeft = Math.floor(left * viewport.width);
      const cropTop = Math.floor(top * viewport.height);
      const cropRight = Math.ceil(right * viewport.width);
      const cropBottom = Math.ceil(bottom * viewport.height);
      const canvas = createCanvas(
        Math.max(1, cropRight - cropLeft),
        Math.max(1, cropBottom - cropTop),
      );
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
