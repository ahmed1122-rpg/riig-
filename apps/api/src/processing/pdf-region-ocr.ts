import type {
  LayerBounds,
  LayerDocument,
  LayerDocumentEditResult,
  LayerNode,
  ProcessingJob,
} from "@motionprep/contracts";
import {
  DocumentProcessingError,
  renderPdfRegion,
  type PdfOcrEngine,
} from "@motionprep/document-processing";
import {
  createPdfTextLayerName,
  validateProductionDocument,
} from "@motionprep/presets";

export type PdfRegionOcrOperation = NonNullable<
  ProcessingJob["options"]["pdfRegionOcr"]
>;

export type PdfRegionOcrErrorCode =
  | "DOCUMENT_REVISION_CONFLICT"
  | "INVALID_DOCUMENT_OPERATION"
  | "OCR_FAILED"
  | "PDF_DECODE_FAILED";

export class PdfRegionOcrError extends Error {
  constructor(
    readonly code: PdfRegionOcrErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export async function applyPdfRegionOcr(input: {
  source: Buffer;
  document: LayerDocument;
  operation: PdfRegionOcrOperation;
  ocrEngine: PdfOcrEngine;
  now?: () => Date;
}): Promise<LayerDocumentEditResult> {
  const { document, operation } = input;
  const currentRevision = document.revision ?? 1;
  if (currentRevision !== operation.baseRevision) {
    throw new PdfRegionOcrError(
      "DOCUMENT_REVISION_CONFLICT",
      "تغيرت وثيقة الطبقات منذ تحديد منطقة OCR. أعد تحميلها ثم حاول مجددًا.",
    );
  }
  if (!document.pages?.some((page) => page.pageNumber === operation.pageNumber)) {
    throw new PdfRegionOcrError(
      "INVALID_DOCUMENT_OPERATION",
      "صفحة PDF المحددة غير موجودة في وثيقة الطبقات.",
    );
  }

  let rendered;
  try {
    rendered = await renderPdfRegion({
      source: input.source,
      pageNumber: operation.pageNumber,
      start: operation.start,
      end: operation.end,
    });
  } catch (error) {
    if (error instanceof DocumentProcessingError) {
      throw new PdfRegionOcrError("PDF_DECODE_FAILED", error.message);
    }
    throw error;
  }

  let recognized;
  try {
    recognized = await input.ocrEngine.recognizePage({
      pageNumber: operation.pageNumber,
      image: rendered.image,
      width: rendered.bounds.width,
      height: rendered.bounds.height,
      renderScale: rendered.renderScale,
    });
  } catch {
    throw new PdfRegionOcrError(
      "OCR_FAILED",
      "تعذر التعرف على النص داخل منطقة PDF المحددة.",
    );
  }
  const usable = recognized.filter(
    (item) =>
      item.text.trim() &&
      Number.isFinite(item.bounds.x) &&
      Number.isFinite(item.bounds.y) &&
      Number.isFinite(item.bounds.width) &&
      Number.isFinite(item.bounds.height) &&
      item.bounds.width > 0 &&
      item.bounds.height > 0,
  );
  if (usable.length === 0) {
    throw new PdfRegionOcrError(
      "OCR_FAILED",
      "لم يعثر OCR على نص داخل المنطقة المحددة.",
    );
  }
  if (usable.length > 2_000) {
    throw new PdfRegionOcrError(
      "INVALID_DOCUMENT_OPERATION",
      "تحتوي منطقة OCR على وحدات نصية أكثر من الحد الآمن. اختر منطقة أصغر.",
    );
  }

  const affected = document.layers.filter(
    (layer) =>
      layer.kind === "text" &&
      layer.pageNumber === operation.pageNumber &&
      layer.bounds &&
      materiallyOverlaps(layer.bounds, rendered.bounds),
  );
  if (affected.some((layer) => layer.locked || layer.fixed)) {
    throw new PdfRegionOcrError(
      "INVALID_DOCUMENT_OPERATION",
      "تتداخل المنطقة مع طبقة نص مقفلة. افتح الطبقة أو اختر منطقة أخرى.",
    );
  }

  const affectedIds = new Set(affected.map((layer) => layer.id));
  const pageZIndex = Math.max(
    0,
    ...document.layers
      .filter((layer) => layer.pageNumber === operation.pageNumber)
      .map((layer) => layer.zIndex),
  );
  const created = usable.map((item, index): LayerNode => {
    const bounds = translateAndClampBounds(item.bounds, rendered.bounds);
    return {
      id: crypto.randomUUID(),
      parentId: null,
      kind: "text",
      name: createPdfTextLayerName(item.text, "word"),
      visible: true,
      locked: false,
      opacity: 1,
      fixed: false,
      zIndex: pageZIndex + index + 1,
      confidence: Math.max(0, Math.min(1, item.confidence)),
      fullText: item.text.trim(),
      pageNumber: operation.pageNumber,
      bounds,
      fontSize: Math.max(1, bounds.height),
      direction: item.direction,
      ...(item.fontFamily ? { fontFamily: item.fontFamily } : {}),
    };
  });
  const layers = normalizeRegionalReadingOrder(
    [
      ...document.layers.filter((layer) => !affectedIds.has(layer.id)),
      ...created,
    ],
    operation.pageNumber,
  );
  const timestamp = (input.now ?? (() => new Date()))().toISOString();
  const timeline = document.editTimeline ?? {
    cursor: 0,
    entries: [
      {
        operationId: `baseline:${document.projectId}:${document.sourceVersionId ?? "source"}:${currentRevision}`,
        kind: "baseline" as const,
        revision: currentRevision,
        actorUserId: operation.actorUserId,
        createdAt: document.generatedAt ?? timestamp,
      },
    ],
  };
  const createdLayerIds = created.map((layer) => layer.id);
  const affectedLayerIds = affected.map((layer) => layer.id);
  const entries = [
    ...timeline.entries.slice(0, timeline.cursor + 1),
    {
      operationId: operation.operationId,
      kind: "pdf-region-ocr" as const,
      revision: currentRevision + 1,
      actorUserId: operation.actorUserId,
      createdAt: timestamp,
      affectedLayerIds,
      createdLayerIds,
      removedLayerIds: affectedLayerIds,
    },
  ].slice(-100);
  const review = input.ocrEngine.getPageReview?.(operation.pageNumber);
  const reviewPages = review
    ? [
        ...(document.ocrReview?.pages.filter(
          (page) => page.pageNumber !== operation.pageNumber,
        ) ?? []),
        review,
      ].sort((left, right) => left.pageNumber - right.pageNumber)
    : document.ocrReview?.pages;
  const updated: LayerDocument = {
    ...document,
    revision: currentRevision + 1,
    layers,
    editTimeline: { entries, cursor: entries.length - 1 },
    ...(reviewPages?.length
      ? {
          ocrReview: {
            policyVersion: "1.0" as const,
            status: "needs_review" as const,
            pages: reviewPages,
          },
        }
      : {}),
  };
  const issues = validateProductionDocument(updated, "book");
  if (issues.length > 0) {
    throw new PdfRegionOcrError(
      "INVALID_DOCUMENT_OPERATION",
      issues[0]?.message ?? "فشل التحقق من وثيقة الطبقات بعد OCR الإقليمي.",
    );
  }
  return {
    document: updated,
    affectedLayerIds,
    createdLayerIds,
    removedLayerIds: affectedLayerIds,
  };
}

function materiallyOverlaps(layer: LayerBounds, region: LayerBounds): boolean {
  const intersectionWidth = Math.max(
    0,
    Math.min(layer.x + layer.width, region.x + region.width) -
      Math.max(layer.x, region.x),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(layer.y + layer.height, region.y + region.height) -
      Math.max(layer.y, region.y),
  );
  const overlap = intersectionWidth * intersectionHeight;
  const centerInside =
    layer.x + layer.width / 2 >= region.x &&
    layer.x + layer.width / 2 <= region.x + region.width &&
    layer.y + layer.height / 2 >= region.y &&
    layer.y + layer.height / 2 <= region.y + region.height;
  return centerInside || overlap / Math.max(1, layer.width * layer.height) >= 0.5;
}

function translateAndClampBounds(
  local: LayerBounds,
  region: LayerBounds,
): LayerBounds {
  const regionRight = region.x + region.width;
  const regionBottom = region.y + region.height;
  const minimumWidth = Math.min(1, region.width);
  const minimumHeight = Math.min(1, region.height);
  const x = clamp(
    region.x + local.x,
    region.x,
    regionRight - minimumWidth,
  );
  const y = clamp(
    region.y + local.y,
    region.y,
    regionBottom - minimumHeight,
  );
  const right = clamp(
    region.x + local.x + local.width,
    x + minimumWidth,
    regionRight,
  );
  const bottom = clamp(
    region.y + local.y + local.height,
    y + minimumHeight,
    regionBottom,
  );
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeRegionalReadingOrder(
  layers: readonly LayerNode[],
  pageNumber: number,
): LayerNode[] {
  const orderedIds = new Map(
    layers
      .filter(
        (layer) =>
          layer.kind === "text" &&
          layer.pageNumber === pageNumber &&
          layer.bounds,
      )
      .sort((left, right) => {
        const vertical = left.bounds!.y - right.bounds!.y;
        if (Math.abs(vertical) > Math.max(2, Math.min(left.bounds!.height, right.bounds!.height) / 2)) {
          return vertical;
        }
        return left.direction === "rtl"
          ? right.bounds!.x - left.bounds!.x
          : left.bounds!.x - right.bounds!.x;
      })
      .map((layer, index) => [layer.id, index]),
  );
  return layers.map((layer) => {
    const readingOrder = orderedIds.get(layer.id);
    return readingOrder === undefined ? layer : { ...layer, readingOrder };
  });
}
