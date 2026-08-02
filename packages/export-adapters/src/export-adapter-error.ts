export type ExportAdapterErrorCode =
  | "INVALID_DOCUMENT_DIMENSIONS"
  | "PSD_DIMENSION_LIMIT_EXCEEDED"
  | "TIFF_PIXEL_BUDGET_EXCEEDED"
  | "RASTER_LAYER_REQUIRED"
  | "RASTER_ASSET_MISMATCH"
  | "RASTER_DECODE_FAILED";

export class ExportAdapterError extends Error {
  constructor(
    readonly code: ExportAdapterErrorCode,
    message: string,
  ) {
    super(message);
  }
}
