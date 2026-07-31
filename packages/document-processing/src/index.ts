import { createRequire } from "node:module";
import type {
  LayerBounds,
  LayerDocument,
  LayerNode,
  NormalizedPoint,
  OcrPageReview,
  PdfSeparationMode,
} from "@motionprep/contracts";
import {
  createPdfBackgroundLayerName,
  createPdfTextLayerName,
} from "@motionprep/presets";
import { createCanvas } from "@napi-rs/canvas";
import type { PDFPageProxy } from "pdfjs-dist";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import Tesseract from "tesseract.js";
import {
  selectOcrFallback,
  type OcrCandidateSummary,
  type OcrFallbackStrategy,
  type OcrPreprocessing,
  type OcrSegmentation,
} from "./ocr-fallback.js";
import {
  evaluateOcrPageReview,
  OCR_REVIEW_POLICY_VERSION,
} from "./ocr-review.js";

const MAX_PDF_PAGES = 250;
const MAX_TEXT_ITEMS = 100_000;
const OCR_TARGET_SCALE = 2;
const OCR_TARGET_LONG_EDGE = 1_600;
const OCR_MAX_RENDER_PIXELS = 24_000_000;
const OCR_TRIM_THRESHOLD = 5;
const OCR_TRIM_PADDING = 36;
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
const LATIN_OVERLAY_MINIMUM_CONFIDENCE = 55;
const LATIN_OVERLAY_MINIMUM_OVERLAP = 0.5;

export interface PreparePdfInput {
  projectId: string;
  sourceVersionId: string;
  source: Buffer;
  separationMode: PdfSeparationMode;
  ocrEngine?: PdfOcrEngine;
}

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
 * Local-only OCR adapter. The bundled Arabic model is loaded from disk and the
 * queue deliberately serializes recognition because one Tesseract worker is
 * not safe to use concurrently.
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
        summarizeOcrWords(
          words,
          prepared.info.width,
          prepared.info.height,
        ),
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
                Math.max(1, word.bbox.x1 - word.bbox.x0) /
                  input.renderScale,
              ),
              height: round(
                Math.max(1, word.bbox.y1 - word.bbox.y0) /
                  input.renderScale,
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
    contentCoverage: calculateContentCoverage(
      words,
      imageWidth,
      imageHeight,
    ),
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
      .trim({
        background: "#ffffff",
        threshold: OCR_TRIM_THRESHOLD,
      })
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
        offsetX:
          -(prepared.info.trimOffsetLeft ?? 0) - OCR_TRIM_PADDING,
        offsetY:
          -(prepared.info.trimOffsetTop ?? 0) - OCR_TRIM_PADDING,
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
        (left, right) =>
          right.latinWord.bbox.x0 - left.latinWord.bbox.x0,
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
    characters.filter((character) =>
      /\p{Script=Arabic}/u.test(character),
    ).length / Math.max(1, characters.length)
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

export class DocumentProcessingError extends Error {
  constructor(
    readonly code:
      | "PDF_DECODE_FAILED"
      | "PDF_TOO_MANY_PAGES"
      | "PDF_TEXT_LIMIT_EXCEEDED"
      | "OCR_REQUIRED"
      | "OCR_FAILED",
    message: string,
    readonly pageNumbers: number[] = [],
  ) {
    super(message);
  }
}

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
  let pdf;
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
        OCR_MAX_RENDER_PIXELS /
          Math.max(1, bounds.width * bounds.height),
      );
      const targetLongEdgeScale =
        OCR_TARGET_LONG_EDGE /
        Math.max(1, bounds.width, bounds.height);
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

interface PositionedText {
  text: string;
  bounds: LayerBounds;
  fontFamily?: string;
  fontSize: number;
  direction: "ltr" | "rtl";
  sourceOrder: number;
  confidence: number;
}

interface TextSegment {
  text: string;
  bounds: LayerBounds;
  fontFamily?: string;
  fontSize: number;
  direction: "ltr" | "rtl";
  confidence: number;
}

export async function preparePdfSource(
  input: PreparePdfInput,
  now: () => Date = () => new Date(),
): Promise<LayerDocument> {
  const loadingTask = getDocument({
    data: new Uint8Array(input.source),
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    useWasm: false,
    stopAtErrors: true,
    maxImageSize: 100_000_000,
    verbosity: 0,
  });

  let pdf: Awaited<typeof loadingTask.promise>;
  try {
    pdf = await loadingTask.promise;
  } catch {
    await loadingTask.destroy();
    throw new DocumentProcessingError(
      "PDF_DECODE_FAILED",
      "تعذر فتح ملف PDF بأمان.",
    );
  }

  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new DocumentProcessingError(
        "PDF_TOO_MANY_PAGES",
        `الحد الأقصى للملف هو ${MAX_PDF_PAGES} صفحة.`,
      );
    }

    const layers: LayerNode[] = [];
    const pages: NonNullable<LayerDocument["pages"]> = [];
    const pagesRequiringOcr: number[] = [];
    const pagesWithOcrFailure: number[] = [];
    const ocrReviewPages: OcrPageReview[] = [];
    let totalTextItems = 0;
    let maxWidth = 0;
    let maxHeight = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const width = round(viewport.width);
      const height = round(viewport.height);
      maxWidth = Math.max(maxWidth, width);
      maxHeight = Math.max(maxHeight, height);
      pages.push({ pageNumber, width, height });
      layers.push(createBackgroundLayer(pageNumber, width, height));

      const textContent = await page.getTextContent({
        includeMarkedContent: false,
        disableNormalization: false,
      });
      let positioned = textContent.items.flatMap((item, sourceOrder) => {
        if (!("str" in item) || !item.str.trim()) return [];
        return [
          positionTextItem(
            item,
            viewport.transform as readonly number[],
            sourceOrder,
          ),
        ];
      });
      if (positioned.length === 0 && (await pageContainsRasterImage(page))) {
        if (!input.ocrEngine) {
          pagesRequiringOcr.push(pageNumber);
          page.cleanup();
          continue;
        }
        try {
          const rendered = await renderPageForOcr(page, width, height);
          const recognized = await input.ocrEngine.recognizePage({
            pageNumber,
            image: rendered.image,
            width,
            height,
            renderScale: rendered.scale,
          });
          const pageReview = input.ocrEngine.getPageReview?.(pageNumber);
          if (pageReview) ocrReviewPages.push(pageReview);
          if (recognized.length === 0) {
            pagesWithOcrFailure.push(pageNumber);
            page.cleanup();
            continue;
          }
          positioned = recognized.map((item, sourceOrder) => ({
            text: item.text,
            bounds: item.bounds,
            ...(item.fontFamily ? { fontFamily: item.fontFamily } : {}),
            fontSize: Math.max(1, item.bounds.height),
            direction: item.direction,
            sourceOrder,
            confidence: item.confidence,
          }));
        } catch {
          pagesWithOcrFailure.push(pageNumber);
          page.cleanup();
          continue;
        }
      }
      totalTextItems += positioned.length;
      if (totalTextItems > MAX_TEXT_ITEMS) {
        throw new DocumentProcessingError(
          "PDF_TEXT_LIMIT_EXCEEDED",
          "يحتوي الملف على عناصر نصية أكثر من الحد الآمن للمعالجة.",
        );
      }
      if (positioned.length === 0) {
        page.cleanup();
        continue;
      }

      const segments = segmentPositionedText(
        positioned,
        input.separationMode,
      );
      segments.forEach((segment, readingOrder) => {
        layers.push({
          id: crypto.randomUUID(),
          parentId: null,
          kind: "text",
          name: createPdfTextLayerName(segment.text, input.separationMode),
          visible: true,
          locked: false,
          opacity: 1,
          fixed: false,
          zIndex: readingOrder + 1,
          confidence: segment.confidence,
          fullText: segment.text,
          pageNumber,
          bounds: segment.bounds,
          readingOrder,
          ...(segment.fontFamily
            ? { fontFamily: segment.fontFamily }
            : {}),
          fontSize: segment.fontSize,
          direction: segment.direction,
        });
      });
      page.cleanup();
    }

    if (pagesRequiringOcr.length > 0) {
      throw new DocumentProcessingError(
        "OCR_REQUIRED",
        "بعض الصفحات صور ممسوحة ولا تحتوي نصًا مضمّنًا؛ يلزم OCR قبل فصلها.",
        pagesRequiringOcr,
      );
    }
    if (pagesWithOcrFailure.length > 0) {
      throw new DocumentProcessingError(
        "OCR_FAILED",
        "تعذر إكمال القراءة الضوئية لبعض الصفحات المصوّرة. أعد المحاولة أو استخدم أداة التحديد اليدوي.",
        pagesWithOcrFailure,
      );
    }

    return {
      schemaVersion: "1.0",
      projectId: input.projectId,
      sourceVersionId: input.sourceVersionId,
      revision: 1,
      generatedAt: now().toISOString(),
      width: maxWidth,
      height: maxHeight,
      colorSpace: "sRGB",
      pages,
      layers,
      ...(ocrReviewPages.length > 0
        ? {
            ocrReview: {
              policyVersion: OCR_REVIEW_POLICY_VERSION,
              status: "needs_review" as const,
              pages: ocrReviewPages,
            },
          }
        : {}),
    };
  } finally {
    await loadingTask.destroy();
  }
}

function createBackgroundLayer(
  pageNumber: number,
  width: number,
  height: number,
): LayerNode {
  return {
    id: crypto.randomUUID(),
    parentId: null,
    kind: "raster",
    name: createPdfBackgroundLayerName(pageNumber),
    visible: true,
    locked: true,
    opacity: 1,
    fixed: true,
    zIndex: 0,
    confidence: 1,
    pageNumber,
    bounds: { x: 0, y: 0, width, height },
    fillColor: "#ffffff",
  };
}

function positionTextItem(
  item: {
    str: string;
    dir: string;
    transform: number[];
    width: number;
    height: number;
    fontName?: string;
  },
  viewportTransform: readonly number[],
  sourceOrder: number,
): PositionedText {
  const transform = multiplyTransforms(viewportTransform, item.transform);
  const fontSize = Math.max(
    1,
    Math.hypot(transform[2] ?? 0, transform[3] ?? 0),
  );
  const width = Math.max(1, Math.abs(item.width));
  const height = Math.max(1, Math.abs(item.height) || fontSize);
  return {
    text: item.str.trim(),
    bounds: {
      x: round(transform[4] ?? 0),
      y: round((transform[5] ?? 0) - height),
      width: round(width),
      height: round(height),
    },
    ...(item.fontName ? { fontFamily: item.fontName } : {}),
    fontSize: round(fontSize),
    direction: item.dir === "rtl" ? "rtl" : "ltr",
    sourceOrder,
    confidence: 1,
  };
}

async function pageContainsRasterImage(page: PDFPageProxy): Promise<boolean> {
  const operatorList = await page.getOperatorList();
  const imageOperations = new Set([
    OPS.paintImageMaskXObject,
    OPS.paintImageMaskXObjectGroup,
    OPS.paintImageMaskXObjectRepeat,
    OPS.paintImageXObject,
    OPS.paintImageXObjectRepeat,
    OPS.paintInlineImageXObject,
    OPS.paintInlineImageXObjectGroup,
    OPS.paintSolidColorImageMask,
  ]);
  return operatorList.fnArray.some((operation) =>
    imageOperations.has(operation),
  );
}

async function renderPageForOcr(
  page: PDFPageProxy,
  width: number,
  height: number,
): Promise<{ image: Buffer; scale: number }> {
  const safePixelScale = Math.sqrt(
    OCR_MAX_RENDER_PIXELS / Math.max(1, width * height),
  );
  const targetLongEdgeScale =
    OCR_TARGET_LONG_EDGE / Math.max(1, width, height);
  const scale = clamp(
    Math.min(OCR_TARGET_SCALE, targetLongEdgeScale, safePixelScale),
    0.25,
    OCR_TARGET_SCALE,
  );
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(
    Math.max(1, Math.ceil(viewport.width)),
    Math.max(1, Math.ceil(viewport.height)),
  );
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    viewport,
    background: "#ffffff",
  }).promise;
  return {
    image: await canvas.encode("png"),
    scale,
  };
}

function multiplyTransforms(
  left: readonly number[],
  right: readonly number[],
): number[] {
  return [
    (left[0] ?? 0) * (right[0] ?? 0) +
      (left[2] ?? 0) * (right[1] ?? 0),
    (left[1] ?? 0) * (right[0] ?? 0) +
      (left[3] ?? 0) * (right[1] ?? 0),
    (left[0] ?? 0) * (right[2] ?? 0) +
      (left[2] ?? 0) * (right[3] ?? 0),
    (left[1] ?? 0) * (right[2] ?? 0) +
      (left[3] ?? 0) * (right[3] ?? 0),
    (left[0] ?? 0) * (right[4] ?? 0) +
      (left[2] ?? 0) * (right[5] ?? 0) +
      (left[4] ?? 0),
    (left[1] ?? 0) * (right[4] ?? 0) +
      (left[3] ?? 0) * (right[5] ?? 0) +
      (left[5] ?? 0),
  ];
}

function segmentPositionedText(
  items: PositionedText[],
  mode: PdfSeparationMode,
): TextSegment[] {
  const lines = groupVisualLines(items);
  if (mode === "line") return lines;
  if (mode === "word" || mode === "character") {
    return lines.flatMap((line) => splitSegment(line, mode));
  }
  if (mode === "sentence") {
    return lines.flatMap((line) => splitSentences(line));
  }
  if (mode === "topic") return groupParagraphs(lines);
  return groupByHeadings(lines);
}

function groupVisualLines(items: PositionedText[]): TextSegment[] {
  const ordered = [...items].sort(
    (left, right) => left.sourceOrder - right.sourceOrder,
  );
  const groups: PositionedText[][] = [];
  for (const item of ordered) {
    const previous = groups.at(-1);
    const anchor = previous?.[0];
    const sameLine =
      anchor &&
      Math.abs(anchor.bounds.y - item.bounds.y) <=
        Math.max(anchor.fontSize, item.fontSize) * 0.55;
    if (previous && sameLine) previous.push(item);
    else groups.push([item]);
  }

  return groups.map((group) => {
    const direction =
      group.filter((item) => item.direction === "rtl").length >
      group.length / 2
        ? "rtl"
        : "ltr";
    const visuallyOrdered = [...group].sort((left, right) =>
      direction === "rtl"
        ? right.bounds.x - left.bounds.x
        : left.bounds.x - right.bounds.x,
    );
    return {
      text: visuallyOrdered.map((item) => item.text).join(" ").trim(),
      bounds: unionBounds(group.map((item) => item.bounds)),
      ...(group[0]?.fontFamily
        ? { fontFamily: group[0].fontFamily }
        : {}),
      fontSize: Math.max(...group.map((item) => item.fontSize)),
      direction,
      confidence:
        group.reduce((sum, item) => sum + item.confidence, 0) /
        group.length,
    };
  });
}

function splitSegment(
  segment: TextSegment,
  mode: "word" | "character",
): TextSegment[] {
  const parts =
    mode === "word"
      ? segment.text.match(/\S+/gu) ?? []
      : Array.from(segment.text).filter((character) => !/\s/u.test(character));
  return distributeAcrossBounds(segment, parts);
}

function splitSentences(segment: TextSegment): TextSegment[] {
  const sentences =
    segment.text.match(/.*?[.!?؟؛…]+(?=\s|$)|.+$/gu)?.map((value) =>
      value.trim(),
    ) ?? [];
  return distributeAcrossBounds(
    segment,
    sentences.filter(Boolean),
  );
}

function distributeAcrossBounds(
  segment: TextSegment,
  parts: string[],
): TextSegment[] {
  const totalCharacters = Math.max(
    1,
    parts.reduce((sum, part) => sum + Array.from(part).length, 0),
  );
  let consumed = 0;
  return parts.map((part) => {
    const fraction = Array.from(part).length / totalCharacters;
    const width = Math.max(1, segment.bounds.width * fraction);
    const x =
      segment.direction === "rtl"
        ? segment.bounds.x +
          segment.bounds.width -
          segment.bounds.width * (consumed + fraction)
        : segment.bounds.x + segment.bounds.width * consumed;
    consumed += fraction;
    return {
      ...segment,
      text: part,
      bounds: {
        ...segment.bounds,
        x: round(x),
        width: round(width),
      },
    };
  });
}

function groupParagraphs(lines: TextSegment[]): TextSegment[] {
  const paragraphs: TextSegment[][] = [];
  for (const line of lines) {
    const previousParagraph = paragraphs.at(-1);
    const previousLine = previousParagraph?.at(-1);
    const gap = previousLine
      ? line.bounds.y - (previousLine.bounds.y + previousLine.bounds.height)
      : Number.POSITIVE_INFINITY;
    if (
      previousParagraph &&
      previousLine &&
      gap <= Math.max(previousLine.fontSize, line.fontSize) * 1.4
    ) {
      previousParagraph.push(line);
    } else {
      paragraphs.push([line]);
    }
  }
  return paragraphs.map(combineSegments);
}

function groupByHeadings(lines: TextSegment[]): TextSegment[] {
  if (lines.length === 0) return [];
  const sizes = lines.map((line) => line.fontSize).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] ?? 1;
  const blocks: TextSegment[][] = [];
  for (const line of lines) {
    const isHeading =
      line.fontSize >= median * 1.25 && Array.from(line.text).length <= 120;
    if (isHeading || blocks.length === 0) blocks.push([line]);
    else blocks.at(-1)?.push(line);
  }
  return blocks.map(combineSegments);
}

function combineSegments(segments: TextSegment[]): TextSegment {
  const first = segments[0];
  if (!first) throw new Error("Cannot combine an empty segment collection.");
  return {
    text: segments.map((segment) => segment.text).join("\n"),
    bounds: unionBounds(segments.map((segment) => segment.bounds)),
    ...(first.fontFamily ? { fontFamily: first.fontFamily } : {}),
    fontSize: Math.max(...segments.map((segment) => segment.fontSize)),
    direction:
      segments.filter((segment) => segment.direction === "rtl").length >
      segments.length / 2
        ? "rtl"
        : "ltr",
    confidence:
      segments.reduce((sum, segment) => sum + segment.confidence, 0) /
      segments.length,
  };
}

function unionBounds(bounds: LayerBounds[]): LayerBounds {
  const x = Math.min(...bounds.map((value) => value.x));
  const y = Math.min(...bounds.map((value) => value.y));
  const right = Math.max(...bounds.map((value) => value.x + value.width));
  const bottom = Math.max(...bounds.map((value) => value.y + value.height));
  return {
    x: round(x),
    y: round(y),
    width: round(right - x),
    height: round(bottom - y),
  };
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
