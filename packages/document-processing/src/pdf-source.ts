import type {
  LayerDocument,
  LayerNode,
  OcrPageReview,
  PdfSeparationMode,
} from "@motionprep/contracts";
import {
  createPdfBackgroundLayerName,
  createPdfPageGroupName,
  createPdfTextLayerName,
} from "@motionprep/presets";
import { normalizeDocumentLayerNames } from "@motionprep/layer-domain";
import type { PDFPageProxy } from "pdfjs-dist";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  DocumentProcessingError,
  type DocumentProcessingDiagnostic,
} from "./document-processing-error.js";
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
import { assertPdfPageGeometry } from "./pdf-geometry.js";

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
    const ocrFailures: DocumentProcessingDiagnostic[] = [];
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
        assertPdfPageGeometry(width, height, pageNumber);
        maxWidth = Math.max(maxWidth, width);
        maxHeight = Math.max(maxHeight, height);
        pages.push({ pageNumber, width, height });
        const pageGroup = createPageGroupLayer(pageNumber, width, height);
        layers.push(
          pageGroup,
          createBackgroundLayer(pageNumber, width, height, pageGroup.id),
        );

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
          ocrFailures.push(pageText.diagnostic);
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
              pageGroup.id,
            ),
          );
        });
      } finally {
        page.cleanup();
      }
    }

    assertOcrCompleted(pagesRequiringOcr, ocrFailures);
    const document: LayerDocument = {
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
    return normalizeDocumentLayerNames(document).document;
  } finally {
    await loadingTask.destroy();
  }
}

type PageTextResult =
  | { status: "ocr-required" }
  | {
      status: "ocr-failed";
      diagnostic: DocumentProcessingDiagnostic;
    }
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

  let rendered: Awaited<ReturnType<typeof renderPageForOcr>>;
  try {
    rendered = await renderPageForOcr(page, pageNumber, width, height);
  } catch {
    return {
      status: "ocr-failed",
      diagnostic: { pageNumber, stage: "render", code: "render-failed" },
    };
  }
  let recognized: Awaited<ReturnType<PdfOcrEngine["recognizePage"]>>;
  try {
    recognized = await ocrEngine.recognizePage({
      pageNumber,
      image: rendered.image,
      width,
      height,
      renderScale: rendered.scale,
    });
  } catch {
    return {
      status: "ocr-failed",
      diagnostic: { pageNumber, stage: "recognize", code: "engine-failed" },
    };
  }
  if (recognized.length === 0) {
    return {
      status: "ocr-failed",
      diagnostic: { pageNumber, stage: "recognize", code: "empty-result" },
    };
  }
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
}

function createPageGroupLayer(
  pageNumber: number,
  width: number,
  height: number,
): LayerNode {
  return {
    id: crypto.randomUUID(),
    parentId: null,
    kind: "group",
    name: createPdfPageGroupName(pageNumber),
    visible: true,
    locked: true,
    opacity: 1,
    fixed: true,
    zIndex: 0,
    confidence: 1,
    pageNumber,
    bounds: { x: 0, y: 0, width, height },
  };
}

function createBackgroundLayer(
  pageNumber: number,
  width: number,
  height: number,
  parentId: string,
): LayerNode {
  return {
    id: crypto.randomUUID(),
    parentId,
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
  parentId: string,
): LayerNode {
  return {
    id: crypto.randomUUID(),
    parentId,
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
  ocrFailures: DocumentProcessingDiagnostic[],
): void {
  if (pagesRequiringOcr.length > 0) {
    throw new DocumentProcessingError(
      "OCR_REQUIRED",
      "بعض الصفحات صور ممسوحة ولا تحتوي نصًا مضمّنًا؛ يلزم OCR قبل فصلها.",
      pagesRequiringOcr,
    );
  }
  if (ocrFailures.length > 0) {
    throw new DocumentProcessingError(
      "OCR_FAILED",
      "تعذر إكمال القراءة الضوئية لبعض الصفحات المصوّرة. أعد المحاولة أو استخدم أداة التحديد اليدوي.",
      [...new Set(ocrFailures.map((failure) => failure.pageNumber))],
      ocrFailures,
    );
  }
}
