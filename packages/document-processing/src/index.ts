export {
  DocumentProcessingError,
  type DocumentProcessingDiagnostic,
  type DocumentProcessingErrorCode,
} from "./document-processing-error.js";
export {
  LocalArabicPdfOcrEngine,
  type LocalArabicPdfOcrOptions,
  type PdfOcrEngine,
  type PdfOcrPageInput,
  type PdfOcrTextItem,
} from "./pdf-ocr.js";
export {
  OCR_SELECTOR_PIPELINES,
  ocrSegmentationMode,
  prepareOcrImage,
  type OcrPipelineConfiguration,
  type PreparedOcrImage,
} from "./ocr-pipeline.js";
export {
  renderPdfRegion,
  type RenderedPdfRegion,
  type RenderPdfRegionInput,
} from "./pdf-region.js";
export {
  preparePdfSource,
  type PreparePdfInput,
} from "./pdf-source.js";
