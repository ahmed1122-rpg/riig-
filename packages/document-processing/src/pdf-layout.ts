import type { LayerBounds, PdfSeparationMode } from "@motionprep/contracts";
import { createCanvas } from "@napi-rs/canvas";
import type { PDFPageProxy } from "pdfjs-dist";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  assertRenderSurface,
  boundedOcrRenderScale,
} from "./pdf-geometry.js";

const OCR_TARGET_SCALE = 2;
const OCR_TARGET_LONG_EDGE = 1_600;
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

export interface PositionedText {
  text: string;
  bounds: LayerBounds;
  fontFamily?: string;
  fontSize: number;
  direction: "ltr" | "rtl";
  sourceOrder: number;
  confidence: number;
}

export interface TextSegment {
  text: string;
  bounds: LayerBounds;
  fontFamily?: string;
  fontSize: number;
  direction: "ltr" | "rtl";
  confidence: number;
}

export function positionTextItem(
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

export async function pageContainsRasterImage(
  page: PDFPageProxy,
): Promise<boolean> {
  const operatorList = await page.getOperatorList();
  return operatorList.fnArray.some((operation) =>
    imageOperations.has(operation),
  );
}

export async function renderPageForOcr(
  page: PDFPageProxy,
  pageNumber: number,
  width: number,
  height: number,
): Promise<{ image: Buffer; scale: number }> {
  const scale = boundedOcrRenderScale({
    width,
    height,
    pageNumber,
    targetScale: OCR_TARGET_SCALE,
    targetLongEdge: OCR_TARGET_LONG_EDGE,
    maxScale: OCR_TARGET_SCALE,
  });
  const viewport = page.getViewport({ scale });
  const canvasWidth = Math.ceil(viewport.width);
  const canvasHeight = Math.ceil(viewport.height);
  assertRenderSurface(canvasWidth, canvasHeight, pageNumber);
  const canvas = createCanvas(canvasWidth, canvasHeight);
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    viewport,
    background: "#ffffff",
  }).promise;
  return { image: await canvas.encode("png"), scale };
}

export function segmentPositionedText(
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
      ...(group[0]?.fontFamily ? { fontFamily: group[0].fontFamily } : {}),
      fontSize: Math.max(...group.map((item) => item.fontSize)),
      direction,
      confidence:
        group.reduce((sum, item) => sum + item.confidence, 0) / group.length,
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
  return distributeAcrossBounds(segment, sentences.filter(Boolean));
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
      bounds: { ...segment.bounds, x: round(x), width: round(width) },
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

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(maximum, Math.max(minimum, value));
}
