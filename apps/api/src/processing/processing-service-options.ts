import type { PdfOcrEngine } from "@motionprep/document-processing";
import type { UsageMeter } from "../billing/usage-meter.js";
import type { RasterAssetWriteObservation } from "./raster-asset-writer.js";

export interface ProcessingServiceRuntimeOptions {
  pdfOcrEngine?: PdfOcrEngine;
  usageMeter?: UsageMeter;
  onAssetCleanupError?: (error: unknown, objectKey: string) => void;
  rasterAssetWriteConcurrency?: number;
  onAssetWriteObservation?: (
    observation: RasterAssetWriteObservation,
  ) => void;
  onAssetWriteObservationError?: (error: unknown) => void;
}
