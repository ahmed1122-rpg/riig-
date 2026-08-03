import { createRequire } from "node:module";
import type { LayerBounds, OcrPageReview } from "@motionprep/contracts";
import sharp from "sharp";
import Tesseract from "tesseract.js";
import {
  selectOcrFallback,
  type OcrCandidateSummary,
  type OcrFallbackStrategy,
  type OcrPreprocessing,
  type OcrSegmentation,
} from "./ocr-fallback.js";
import { evaluateOcrPageReview } from "./ocr-review.js";

const OCR_TRIM_THRESHOLD = 5;
const OCR_TRIM_PADDING = 36;
const LATIN_OVERLAY_MINIMUM_CONFIDENCE = 55;
const LATIN_OVERLAY_MINIMUM_OVERLAP = 0.5;
const require = createRequire(import.meta.url);
const bundledArabicLanguage = require("@tesseract.js-data/ara") as {
  code: "ara";
  gzip: boolean;
  langPath: string;
};
const bundledEnglishLanguage = require("@tesseract.js-data/eng") as {
  code: "eng";
  gzip: boolean;
  langPath: string;
};

export interface PdfOcrPageInput {
  pageNumber: number;
  image: Buffer;
  width: number;
  height: number;
  renderScale: number;
}

export interface PdfOcrTextItem {
  text: string;
  bounds: LayerBounds;
  confidence: number;
  direction: "ltr" | "rtl";
  fontFamily?: string;
}

export interface PdfOcrEngine {
  recognizePage(input: PdfOcrPageInput): Promise<PdfOcrTextItem[]>;
  getPageReview?(pageNumber: number): OcrPageReview | undefined;
  close?(): Promise<void>;
}

export interface LocalArabicPdfOcrOptions {
  onProgress?: (event: {
    status: string;
    progress: number;
    pageNumber?: number;
  }) => void;
  onFallback?: (event: {
    pageNumber: number;
    strategy: OcrFallbackStrategy;
    primary: OcrCandidateSummary;
  }) => void;
  onReviewRequired?: (review: OcrPageReview) => void;
}

/**
 * Local-only OCR adapter. Recognition is deliberately serialized because one
 * Tesseract worker is not safe to use concurrently.
 */
export class LocalArabicPdfOcrEngine implements PdfOcrEngine {
  private workerPromise: Promise<Tesseract.Worker> | null = null;
  private englishWorkerPromise: Promise<Tesseract.Worker> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private activePageNumber: number | undefined;
  private readonly reviews = new Map<number, OcrPageReview>();

  constructor(private readonly options: LocalArabicPdfOcrOptions = {}) {}

  recognizePage(input: PdfOcrPageInput): Promise<PdfOcrTextItem[]> {
    const task = this.queue.then(() => this.runRecognition(input));
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  getPageReview(pageNumber: number): OcrPageReview | undefined {
    return this.reviews.get(pageNumber);
  }

  async close(): Promise<void> {
    await this.queue;
    const workers = await Promise.all(
      [this.workerPromise, this.englishWorkerPromise].filter(
        (worker): worker is Promise<Tesseract.Worker> => Boolean(worker),
      ),
    );
    await Promise.all(workers.map((worker) => worker.terminate()));
    this.workerPromise = null;
    this.englishWorkerPromise = null;
    this.reviews.clear();
  }

  private async runRecognition(
    input: PdfOcrPageInput,
  ): Promise<PdfOcrTextItem[]> {
    this.activePageNumber = input.pageNumber;
    try {
      const worker = await this.getWorker();
      const prepared = await prepareOcrImage(input.image, "normalize");
      await worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      });
      const primary = await recognizeWords(
        worker,
        prepared.data,
        prepared.info.width,
        prepared.info.height,
      );
      let words = primary.words;
      const primarySummary = {
        wordCount: primary.words.length,
        averageConfidence: primary.averageConfidence,
        arabicCharacterRatio: primary.arabicCharacterRatio,
        contentCoverage: primary.contentCoverage,
      };
      const fallbackStrategy = selectOcrFallback(primarySummary);
      if (fallbackStrategy) {
        this.options.onFallback?.({
          pageNumber: input.pageNumber,
          strategy: fallbackStrategy,
          primary: primarySummary,
        });
        words = await this.runFallback(
          worker,
          input.image,
          prepared,
          fallbackStrategy,
          primary.words,
        );
      }

      const review = evaluateOcrPageReview(
        input.pageNumber,
        summarizeOcrWords(words, prepared.info.width, prepared.info.height),
        Boolean(fallbackStrategy),
      );
      if (review) {
        this.reviews.set(input.pageNumber, review);
        this.options.onReviewRequired?.(review);
      } else {
        this.reviews.delete(input.pageNumber);
      }

      return words.flatMap((word) => {
        const text = word.text.trim();
        if (!text) return [];
        return [
          {
            text,
            bounds: {
              x: round(word.bbox.x0 / input.renderScale),
              y: round(word.bbox.y0 / input.renderScale),
              width: round(
                Math.max(1, word.bbox.x1 - word.bbox.x0) / input.renderScale,
              ),
              height: round(
                Math.max(1, word.bbox.y1 - word.bbox.y0) / input.renderScale,
              ),
            },
            confidence: clamp(word.confidence / 100, 0, 1),
            direction: containsArabic(text) ? "rtl" : "ltr",
            ...(word.font_name ? { fontFamily: word.font_name } : {}),
          } satisfies PdfOcrTextItem,
        ];
      });
    } finally {
      this.activePageNumber = undefined;
    }
  }

  private async runFallback(
    worker: Tesseract.Worker,
    source: Buffer,
    normalized: PreparedOcrImage,
    strategy: OcrFallbackStrategy,
    primaryWords: Tesseract.Word[],
  ): Promise<Tesseract.Word[]> {
    if (strategy.latinOverlay) {
      const englishWorker = await this.getEnglishWorker();
      await englishWorker.setParameters({
        tessedit_pageseg_mode: segmentationMode(strategy.segmentation),
      });
      const english = await recognizeWords(
        englishWorker,
        normalized.data,
        normalized.info.width,
        normalized.info.height,
      );
      return overlayConfidentLatinWords(primaryWords, english.words);
    }

    try {
      await worker.setParameters({
        tessedit_pageseg_mode: segmentationMode(strategy.segmentation),
      });
      const prepared =
        strategy.preprocessing === "normalize"
          ? normalized
          : await prepareOcrImage(source, strategy.preprocessing);
      const fallback = await recognizeWords(
        worker,
        prepared.data,
        prepared.info.width,
        prepared.info.height,
      );
      return offsetOcrWords(
        fallback.words,
        prepared.info.offsetX,
        prepared.info.offsetY,
      );
    } finally {
      await worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      });
    }
  }

  private getWorker(): Promise<Tesseract.Worker> {
    if (!this.workerPromise) {
      this.workerPromise = this.createWorker(bundledArabicLanguage);
    }
    return this.workerPromise;
  }

  private getEnglishWorker(): Promise<Tesseract.Worker> {
    if (!this.englishWorkerPromise) {
      this.englishWorkerPromise = this.createWorker(bundledEnglishLanguage);
    }
    return this.englishWorkerPromise;
  }

  private createWorker(language: {
    code: string;
    gzip: boolean;
    langPath: string;
  }): Promise<Tesseract.Worker> {
    return Tesseract.createWorker(language.code, Tesseract.OEM.LSTM_ONLY, {
      langPath: language.langPath,
      gzip: language.gzip,
      cacheMethod: "none",
      logger: (message) =>
        this.options.onProgress?.({
          status: message.status,
          progress: clamp(message.progress, 0, 1),
          ...(this.activePageNumber
            ? { pageNumber: this.activePageNumber }
            : {}),
        }),
    }).then(async (worker) => {
      await worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.AUTO,
        preserve_interword_spaces: "1",
        user_defined_dpi: "144",
      });
      return worker;
    });
  }
}

interface OcrCandidate extends OcrCandidateSummary {
  words: Tesseract.Word[];
}

async function recognizeWords(
  worker: Tesseract.Worker,
  image: Buffer,
  imageWidth: number,
  imageHeight: number,
): Promise<OcrCandidate> {
  const result = await worker.recognize(
    image,
    {},
    { text: true, blocks: true },
  );
  const words =
    result.data.blocks?.flatMap((block) =>
      block.paragraphs.flatMap((paragraph) =>
        paragraph.lines.flatMap((line) => line.words),
      ),
    ) ?? [];
  return summarizeOcrWords(words, imageWidth, imageHeight);
}

function summarizeOcrWords(
  words: Tesseract.Word[],
  imageWidth: number,
  imageHeight: number,
): OcrCandidate {
  return {
    words,
    wordCount: words.length,
    averageConfidence:
      words.reduce((sum, word) => sum + word.confidence / 100, 0) /
      Math.max(1, words.length),
    arabicCharacterRatio: calculateArabicCharacterRatio(words),
    contentCoverage: calculateContentCoverage(words, imageWidth, imageHeight),
  };
}

interface PreparedOcrImage {
  data: Buffer;
  info: {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  };
}

async function prepareOcrImage(
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

function offsetOcrWords(
  words: Tesseract.Word[],
  offsetX: number,
  offsetY: number,
): Tesseract.Word[] {
  if (offsetX === 0 && offsetY === 0) return words;
  return words.map((word) => ({
    ...word,
    bbox: {
      x0: word.bbox.x0 + offsetX,
      y0: word.bbox.y0 + offsetY,
      x1: word.bbox.x1 + offsetX,
      y1: word.bbox.y1 + offsetY,
    },
  }));
}

function overlayConfidentLatinWords(
  arabicWords: Tesseract.Word[],
  englishWords: Tesseract.Word[],
): Tesseract.Word[] {
  const latinWords = englishWords.filter(
    (word) =>
      word.confidence >= LATIN_OVERLAY_MINIMUM_CONFIDENCE &&
      /[A-Za-zÀ-ÿ]{3}/u.test(word.text),
  );
  const usedLatinWords = new Set<number>();
  return arabicWords.flatMap((arabicWord) => {
    const matches = latinWords
      .map((latinWord, index) => ({ latinWord, index }))
      .filter(
        ({ latinWord, index }) =>
          !usedLatinWords.has(index) &&
          boundingBoxOverlap(arabicWord.bbox, latinWord.bbox) >=
            LATIN_OVERLAY_MINIMUM_OVERLAP,
      )
      .sort(
        (left, right) => right.latinWord.bbox.x0 - left.latinWord.bbox.x0,
      );
    if (matches.length === 0) return [arabicWord];
    for (const match of matches) usedLatinWords.add(match.index);
    return matches.map(({ latinWord }) => latinWord);
  });
}

function boundingBoxOverlap(
  left: Tesseract.Bbox,
  right: Tesseract.Bbox,
): number {
  const intersectionWidth = Math.max(
    0,
    Math.min(left.x1, right.x1) - Math.max(left.x0, right.x0),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(left.y1, right.y1) - Math.max(left.y0, right.y0),
  );
  const intersectionArea = intersectionWidth * intersectionHeight;
  const leftArea = (left.x1 - left.x0) * (left.y1 - left.y0);
  const rightArea = (right.x1 - right.x0) * (right.y1 - right.y0);
  return intersectionArea / Math.max(1, Math.min(leftArea, rightArea));
}

function segmentationMode(segmentation: OcrSegmentation): Tesseract.PSM {
  switch (segmentation) {
    case "auto":
      return Tesseract.PSM.AUTO;
    case "single-column":
      return Tesseract.PSM.SINGLE_COLUMN;
    case "single-block":
      return Tesseract.PSM.SINGLE_BLOCK;
    case "sparse-text":
      return Tesseract.PSM.SPARSE_TEXT;
  }
}

function calculateArabicCharacterRatio(words: Tesseract.Word[]): number {
  const characters = Array.from(
    words.map((word) => word.text).join("").replace(/\s/gu, ""),
  );
  return (
    characters.filter((character) => /\p{Script=Arabic}/u.test(character))
      .length / Math.max(1, characters.length)
  );
}

function calculateContentCoverage(
  words: Tesseract.Word[],
  imageWidth: number,
  imageHeight: number,
): number {
  if (words.length === 0) return 0;
  const left = Math.min(...words.map((word) => word.bbox.x0));
  const top = Math.min(...words.map((word) => word.bbox.y0));
  const right = Math.max(...words.map((word) => word.bbox.x1));
  const bottom = Math.max(...words.map((word) => word.bbox.y1));
  return (
    ((right - left) * (bottom - top)) /
    Math.max(1, imageWidth * imageHeight)
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function containsArabic(value: string): boolean {
  return /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/u.test(
    value,
  );
}
