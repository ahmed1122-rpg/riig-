import type {
  LayerDocument,
  LayerNode,
  OcrPageReview,
  PdfSeparationMode,
} from "@motionprep/contracts";
import {
  createPdfBackgroundLayerName,
  createPdfTextLayerName,
} from "@motionprep/presets";
import type { PDFPageProxy } from "pdfjs-dist";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DocumentProcessingError } from "./document-processing-error.js";
import { OCR_REVIEW_POLICY_VERSION } from "./ocr-review.js";
import type { PdfOcrEngine } from "./pdf-ocr.js";
import {
  pageContainsRasterImage,
  positionTextItem,
  renderPageForOcr,
  round,
  segmentPositionedText,
  type PositionedText,
} from "./pdf-layout.js";
import { deterministicPdfJsOptions } from "./pdfjs-options.js";

const MAX_PDF_PAGES = 250;
const MAX_TEXT_ITEMS = 100_000;

export interface PreparePdfInput {
  projectId: string;
  sourceVersionId: string;
  source: Buffer;
  separationMode: PdfSeparationMode;
  ocrEngine?: PdfOcrEngine;
}

export async function preparePdfSource(
  input: PreparePdfInput,
  now: () => Date = () => new Date(),
): Promise<LayerDocument> {
  const loadingTask = getDocument({
    data: new Uint8Array(input.source),
    ...deterministicPdfJsOptions,
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
      try {
        const viewport = page.getViewport({ scale: 1 });
        const width = round(viewport.width);
        const height = round(viewport.height);
        maxWidth = Math.max(maxWidth, width);
        maxHeight = Math.max(maxHeight, height);
        pages.push({ pageNumber, width, height });
        layers.push(createBackgroundLayer(pageNumber, width, height));

        const pageText = await extractPageText(
          page,
          pageNumber,
          width,
          height,
          viewport.transform as readonly number[],
          input.ocrEngine,
        );
        if (pageText.status === "ocr-required") {
          pagesRequiringOcr.push(pageNumber);
          continue;
        }
        if (pageText.status === "ocr-failed") {
          pagesWithOcrFailure.push(pageNumber);
          continue;
        }
        if (pageText.review) ocrReviewPages.push(pageText.review);

        totalTextItems += pageText.positioned.length;
        if (totalTextItems > MAX_TEXT_ITEMS) {
          throw new DocumentProcessingError(
            "PDF_TEXT_LIMIT_EXCEEDED",
            "يحتوي الملف على عناصر نصية أكثر من الحد الآمن للمعالجة.",
          );
        }

        const segments = segmentPositionedText(
          pageText.positioned,
          input.separationMode,
        );
        segments.forEach((segment, readingOrder) => {
          layers.push(
            createTextLayer(
              segment,
              pageNumber,
              readingOrder,
              input.separationMode,
            ),
          );
        });
      } finally {
        page.cleanup();
      }
    }

    assertOcrCompleted(pagesRequiringOcr, pagesWithOcrFailure);
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

type PageTextResult =
  | { status: "ocr-required" }
  | { status: "ocr-failed" }
  | {
      status: "ready";
      positioned: PositionedText[];
      review?: OcrPageReview;
    };

async function extractPageText(
  page: PDFPageProxy,
  pageNumber: number,
  width: number,
  height: number,
  viewportTransform: readonly number[],
  ocrEngine?: PdfOcrEngine,
): Promise<PageTextResult> {
  const textContent = await page.getTextContent({
    includeMarkedContent: false,
    disableNormalization: false,
  });
  const embedded = textContent.items.flatMap((item, sourceOrder) => {
    if (!("str" in item) || !item.str.trim()) return [];
    return [positionTextItem(item, viewportTransform, sourceOrder)];
  });
  if (embedded.length > 0 || !(await pageContainsRasterImage(page))) {
    return { status: "ready", positioned: embedded };
  }
  if (!ocrEngine) return { status: "ocr-required" };

  try {
    const rendered = await renderPageForOcr(page, width, height);
    const recognized = await ocrEngine.recognizePage({
      pageNumber,
      image: rendered.image,
      width,
      height,
      renderScale: rendered.scale,
    });
    if (recognized.length === 0) return { status: "ocr-failed" };
    const review = ocrEngine.getPageReview?.(pageNumber);
    return {
      status: "ready",
      positioned: recognized.map((item, sourceOrder) => ({
        text: item.text,
        bounds: item.bounds,
        ...(item.fontFamily ? { fontFamily: item.fontFamily } : {}),
        fontSize: Math.max(1, item.bounds.height),
        direction: item.direction,
        sourceOrder,
        confidence: item.confidence,
      })),
      ...(review ? { review } : {}),
    };
  } catch {
    return { status: "ocr-failed" };
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

function createTextLayer(
  segment: ReturnType<typeof segmentPositionedText>[number],
  pageNumber: number,
  readingOrder: number,
  separationMode: PdfSeparationMode,
): LayerNode {
  return {
    id: crypto.randomUUID(),
    parentId: null,
    kind: "text",
    name: createPdfTextLayerName(segment.text, separationMode),
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
    ...(segment.fontFamily ? { fontFamily: segment.fontFamily } : {}),
    fontSize: segment.fontSize,
    direction: segment.direction,
  };
}

function assertOcrCompleted(
  pagesRequiringOcr: number[],
  pagesWithOcrFailure: number[],
): void {
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
}
