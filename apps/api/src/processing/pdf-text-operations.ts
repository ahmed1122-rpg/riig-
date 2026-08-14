import type {
  LayerDocument,
  LayerNode,
} from "@motionprep/contracts";
import {
  canonicalLayerName,
  createPdfTextLayerName,
  createUniqueLayerName,
} from "@motionprep/layer-domain";
import { ProcessingDomainError } from "./processing-errors.js";
import { unionLayerBounds } from "./layer-operation-utils.js";
import { applyReadingOrder } from "./reading-order.js";

interface PreparedPdfTextOperation {
  changed: LayerDocument;
  details: {
    affectedLayerIds: string[];
    createdLayerIds: string[];
    removedLayerIds: string[];
  };
}

export function preparePdfTextSplit(
  document: LayerDocument,
  input: { layerId: string; offset: number },
): PreparedPdfTextOperation {
  if (!document.pages?.length) {
    throw invalid("تقسيم النص متاح لمستندات PDF فقط.");
  }
  const layer = document.layers.find(
    (candidate) => candidate.id === input.layerId,
  );
  if (
    !layer ||
    layer.kind !== "text" ||
    layer.fixed ||
    layer.locked ||
    layer.pageNumber === undefined ||
    !layer.fullText ||
    !layer.bounds
  ) {
    throw invalid(
      "اختر طبقة نصية غير مقفلة لها نص وحدود صالحة قبل التقسيم.",
    );
  }
  const characters = Array.from(layer.fullText);
  if (
    !Number.isSafeInteger(input.offset) ||
    input.offset <= 0 ||
    input.offset >= characters.length
  ) {
    throw invalid(
      "يجب أن يقع موضع التقسيم بين أول وآخر حرف في الوحدة النصية.",
    );
  }
  const firstText = characters.slice(0, input.offset).join("");
  const secondText = characters.slice(input.offset).join("");
  if (!firstText.trim() || !secondText.trim()) {
    throw invalid("لا يمكن إنشاء جزء نصي فارغ أو مكوّن من مسافات فقط.");
  }
  const ratio = input.offset / characters.length;
  const firstWidth = layer.bounds.width * ratio;
  const secondWidth = layer.bounds.width - firstWidth;
  const rtl = layer.direction === "rtl";
  const createdLayerId = crypto.randomUUID();
  const usedNames = siblingNames(document.layers, layer, new Set([layer.id]));
  const firstName = createUniqueLayerName(
    createPdfTextLayerName(firstText, "sentence"),
    usedNames,
  );
  usedNames.add(canonicalLayerName(firstName));
  const first: LayerNode = {
    ...layer,
    name: firstName,
    fullText: firstText,
    bounds: {
      ...layer.bounds,
      x: rtl ? layer.bounds.x + secondWidth : layer.bounds.x,
      width: firstWidth,
    },
  };
  const second: LayerNode = {
    ...layer,
    id: createdLayerId,
    name: createUniqueLayerName(
      createPdfTextLayerName(secondText, "sentence"),
      usedNames,
    ),
    fullText: secondText,
    bounds: {
      ...layer.bounds,
      x: rtl ? layer.bounds.x : layer.bounds.x + firstWidth,
      width: secondWidth,
    },
    zIndex: layer.zIndex + 1,
    readingOrder: (layer.readingOrder ?? 0) + 1,
  };
  const layers = document.layers.flatMap((candidate) =>
    candidate.id === layer.id ? [first, second] : [candidate],
  );
  const details = {
    affectedLayerIds: [layer.id],
    createdLayerIds: [createdLayerId],
    removedLayerIds: [],
  };
  return {
    changed: {
      ...document,
      layers: normalizePageReadingOrder(layers, layer.pageNumber),
    },
    details,
  };
}

export function preparePdfTextMerge(
  document: LayerDocument,
  input: {
    layerIds: readonly string[];
    separator: "space" | "newline";
  },
): PreparedPdfTextOperation {
  if (!document.pages?.length) {
    throw invalid("دمج النص متاح لمستندات PDF فقط.");
  }
  const uniqueIds = [...new Set(input.layerIds)];
  if (uniqueIds.length < 2 || uniqueIds.length > 50) {
    throw invalid("اختر من طبقتين إلى خمسين طبقة نصية للدمج.");
  }
  const selected = uniqueIds.map((id) =>
    document.layers.find((layer) => layer.id === id),
  );
  if (
    selected.some(
      (layer) =>
        !layer ||
        layer.kind !== "text" ||
        layer.fixed ||
        layer.locked ||
        layer.pageNumber === undefined ||
        !layer.fullText ||
        !layer.bounds,
    )
  ) {
    throw invalid(
      "يجب أن تكون كل الوحدات المحددة طبقات نصية غير مقفلة ولها نص وحدود.",
    );
  }
  const textLayers = selected as LayerNode[];
  const pageNumber = textLayers[0]!.pageNumber!;
  const parentId = textLayers[0]!.parentId;
  const direction = textLayers[0]!.direction;
  const textAlign = textLayers[0]!.textAlign ?? "start";
  if (
    textLayers.some(
      (layer) =>
        layer.pageNumber !== pageNumber ||
        layer.parentId !== parentId ||
        layer.direction !== direction ||
        (layer.textAlign ?? "start") !== textAlign,
    )
  ) {
    throw invalid(
      "لا يمكن دمج نصوص من صفحات أو مجموعات أو اتجاهات كتابة أو محاذاة مختلفة.",
    );
  }
  const ordered = [...textLayers].sort(compareTextLayers);
  const separator = input.separator === "newline" ? "\n" : " ";
  const fullText = ordered
    .map((layer) => layer.fullText!.trim())
    .join(separator);
  const survivor = ordered[0]!;
  const removedIds = new Set(ordered.slice(1).map((layer) => layer.id));
  const selectedIds = new Set(ordered.map((layer) => layer.id));
  const readingOrders = ordered.flatMap((layer) =>
    layer.readingOrder === undefined ? [] : [layer.readingOrder],
  );
  const merged: LayerNode = {
    ...survivor,
    name: createUniqueLayerName(
      createPdfTextLayerName(fullText, "sentence"),
      siblingNames(document.layers, survivor, selectedIds),
    ),
    fullText,
    bounds: unionLayerBounds(ordered.map((layer) => layer.bounds!)),
    visible: ordered.some((layer) => layer.visible),
    opacity: Math.max(...ordered.map((layer) => layer.opacity)),
    zIndex: Math.min(...ordered.map((layer) => layer.zIndex)),
    ...(readingOrders.length > 0
      ? { readingOrder: Math.min(...readingOrders) }
      : {}),
  };
  const layers = document.layers
    .filter((layer) => !removedIds.has(layer.id))
    .map((layer) => (layer.id === survivor.id ? merged : layer));
  const details = {
    affectedLayerIds: uniqueIds,
    createdLayerIds: [],
    removedLayerIds: [...removedIds],
  };
  return {
    changed: {
      ...document,
      layers: normalizePageReadingOrder(layers, pageNumber),
    },
    details,
  };
}

function siblingNames(
  layers: readonly LayerNode[],
  target: LayerNode,
  excludedIds: ReadonlySet<string>,
): Set<string> {
  return new Set(
    layers
      .filter(
        (layer) =>
          !excludedIds.has(layer.id) &&
          layer.parentId === target.parentId &&
          (layer.pageNumber ?? null) === (target.pageNumber ?? null),
      )
      .map((layer) => canonicalLayerName(layer.name)),
  );
}

function invalid(message: string): ProcessingDomainError {
  return new ProcessingDomainError("INVALID_DOCUMENT_OPERATION", message);
}

function compareTextLayers(left: LayerNode, right: LayerNode): number {
  const order =
    (left.readingOrder ?? Number.MAX_SAFE_INTEGER) -
    (right.readingOrder ?? Number.MAX_SAFE_INTEGER);
  if (order !== 0) return order;
  const vertical = (left.bounds?.y ?? 0) - (right.bounds?.y ?? 0);
  if (Math.abs(vertical) > 1) return vertical;
  return (left.bounds?.x ?? 0) - (right.bounds?.x ?? 0);
}

function normalizePageReadingOrder(
  layers: readonly LayerNode[],
  pageNumber: number,
): LayerNode[] {
  return applyReadingOrder(layers, {
    appliesTo: (layer) =>
      layer.kind === "text" && layer.pageNumber === pageNumber,
    compare: compareTextLayers,
    startAt: 1,
  });
}
