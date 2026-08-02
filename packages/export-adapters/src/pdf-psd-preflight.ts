import type { DocumentPage, LayerDocument } from "@motionprep/contracts";

import { assertDocumentDimensions } from "./document-dimensions.js";
import { ExportAdapterError } from "./export-adapter-error.js";

const PSD_LAYER_PIXEL_BUDGET = 50_000_000;

export function preflightPdfPages(
  document: LayerDocument,
  pageNumbers: readonly number[],
): DocumentPage[] {
  const pagesByNumber = new Map(
    (document.pages ?? []).map((page) => [page.pageNumber, page]),
  );
  const selectedPages = pageNumbers.map((pageNumber) => {
    const page = pagesByNumber.get(pageNumber);
    if (!page) {
      throw new ExportAdapterError(
        "INVALID_DOCUMENT_DIMENSIONS",
        `PDF page ${pageNumber} is not present in the layer document.`,
      );
    }
    const dimensions = {
      ...page,
      width: Math.ceil(page.width),
      height: Math.ceil(page.height),
    };
    assertDocumentDimensions(dimensions, true);
    return dimensions;
  });
  const width = Math.max(...selectedPages.map((page) => page.width));
  const height = selectedPages.reduce((sum, page) => sum + page.height, 0);
  assertDocumentDimensions({ width, height }, true);

  const selectedByNumber = new Map(
    selectedPages.map((page) => [page.pageNumber, page]),
  );
  const backgroundPixels = selectedPages.reduce(
    (total, page) => total + page.width * page.height,
    0,
  );
  const textPixels = document.layers.reduce((total, layer) => {
    if (
      layer.kind !== "text" ||
      !layer.fullText ||
      !layer.bounds ||
      layer.pageNumber === undefined
    ) {
      return total;
    }
    const page = selectedByNumber.get(layer.pageNumber);
    if (!page) return total;
    const left = clampInteger(Math.floor(layer.bounds.x), 0, page.width - 1);
    const top = clampInteger(Math.floor(layer.bounds.y), 0, page.height - 1);
    const width = Math.max(
      1,
      Math.min(page.width - left, Math.ceil(layer.bounds.width)),
    );
    const height = Math.max(
      1,
      Math.min(page.height - top, Math.ceil(layer.bounds.height)),
    );
    return total + width * height;
  }, 0);
  if (backgroundPixels + textPixels > PSD_LAYER_PIXEL_BUDGET) {
    throw new ExportAdapterError(
      "INVALID_DOCUMENT_DIMENSIONS",
      "PDF text layers exceed the safe PSD raster memory budget; export per page or reduce the layer scope.",
    );
  }
  return selectedPages;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
