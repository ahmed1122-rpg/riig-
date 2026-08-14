import sharp from "sharp";
import Tesseract from "tesseract.js";
import type {
  OcrPreprocessing,
  OcrSegmentation,
} from "./ocr-fallback.js";

const OCR_TRIM_THRESHOLD = 5;
const OCR_TRIM_PADDING = 36;

export interface PreparedOcrImage {
  data: Buffer;
  info: {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  };
}

export interface OcrPipelineConfiguration {
  id: string;
  segmentation: OcrSegmentation;
  preprocessing: OcrPreprocessing;
}

/**
 * Candidate grid used to compare selector strategies on development and
 * validation samples. Production and evaluation deliberately share this data
 * so a benchmark cannot silently exercise a different image pipeline.
 */
const selectorPipelines: OcrPipelineConfiguration[] = [
  {
    id: "auto-normalize",
    segmentation: "auto",
    preprocessing: "normalize",
  },
  {
    id: "column-normalize",
    segmentation: "single-column",
    preprocessing: "normalize",
  },
  {
    id: "block-normalize",
    segmentation: "single-block",
    preprocessing: "normalize",
  },
  {
    id: "sparse-normalize",
    segmentation: "sparse-text",
    preprocessing: "normalize",
  },
  {
    id: "column-threshold-190",
    segmentation: "single-column",
    preprocessing: "threshold-190",
  },
  {
    id: "sparse-threshold-190",
    segmentation: "sparse-text",
    preprocessing: "threshold-190",
  },
  {
    id: "sparse-sharpen",
    segmentation: "sparse-text",
    preprocessing: "sharpen",
  },
  {
    id: "sparse-median",
    segmentation: "sparse-text",
    preprocessing: "median",
  },
  {
    id: "auto-sharpen",
    segmentation: "auto",
    preprocessing: "sharpen",
  },
  {
    id: "auto-trim-sharpen",
    segmentation: "auto",
    preprocessing: "trim-sharpen",
  },
];

export const OCR_SELECTOR_PIPELINES: readonly OcrPipelineConfiguration[] =
  Object.freeze(
    selectorPipelines.map((configuration) => Object.freeze(configuration)),
  );

export async function prepareOcrImage(
  source: Buffer,
  preprocessing: OcrPreprocessing,
): Promise<PreparedOcrImage> {
  if (preprocessing === "trim-sharpen") {
    const prepared = await sharp(source)
      .trim({ background: "#ffffff", threshold: OCR_TRIM_THRESHOLD })
      .extend({
        top: OCR_TRIM_PADDING,
        bottom: OCR_TRIM_PADDING,
        left: OCR_TRIM_PADDING,
        right: OCR_TRIM_PADDING,
        background: "#ffffff",
      })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1 })
      .png()
      .toBuffer({ resolveWithObject: true });
    return {
      data: prepared.data,
      info: {
        width: prepared.info.width,
        height: prepared.info.height,
        offsetX: -(prepared.info.trimOffsetLeft ?? 0) - OCR_TRIM_PADDING,
        offsetY: -(prepared.info.trimOffsetTop ?? 0) - OCR_TRIM_PADDING,
      },
    };
  }

  let pipeline = sharp(source).grayscale();
  switch (preprocessing) {
    case "normalize":
      pipeline = pipeline.normalize();
      break;
    case "threshold-190":
      pipeline = pipeline.threshold(190);
      break;
    case "sharpen":
      pipeline = pipeline.normalize().sharpen({ sigma: 1 });
      break;
    case "median":
      pipeline = pipeline.normalize().median(3);
      break;
    default:
      throw new Error("Unsupported OCR preprocessing policy.");
  }
  const prepared = await pipeline.png().toBuffer({ resolveWithObject: true });
  return {
    data: prepared.data,
    info: {
      width: prepared.info.width,
      height: prepared.info.height,
      offsetX: 0,
      offsetY: 0,
    },
  };
}

export function ocrSegmentationMode(
  segmentation: OcrSegmentation,
): Tesseract.PSM {
  switch (segmentation) {
    case "auto":
      return Tesseract.PSM.AUTO;
    case "single-column":
      return Tesseract.PSM.SINGLE_COLUMN;
    case "single-block":
      return Tesseract.PSM.SINGLE_BLOCK;
    case "sparse-text":
      return Tesseract.PSM.SPARSE_TEXT;
    default:
      throw new Error("Unsupported OCR segmentation policy.");
  }
}
