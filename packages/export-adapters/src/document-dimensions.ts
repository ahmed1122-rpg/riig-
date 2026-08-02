import type { LayerDocument } from "@motionprep/contracts";

import { ExportAdapterError } from "./export-adapter-error.js";

export const MAX_DECODED_PIXELS = 25_000_000;
const PSD_MAX_DIMENSION = 30_000;

export function assertDocumentDimensions(
  document: Pick<LayerDocument, "width" | "height">,
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
