import type { ImageGuidanceStroke } from "@motionprep/contracts";
import sharp from "sharp";
import {
  type AppliedRasterGuidance,
  type ApplyRasterGuidanceInput,
  MediaProcessingError,
} from "./media-processing-types.js";
import {
  alphaAt,
  decodeRgba,
} from "./raster-pixels.js";

const MAX_GUIDED_FILL_REGION_PIXELS = 4_000_000;
const GUIDED_FILL_SEARCH_PADDING = 128;

/**
 * Applies deterministic manual inclusion, exclusion, and separation masks to
 * one prepared raster layer. Inclusion fills only transparent pixels under the
 * user's brush from the nearest visible source pixel; exclusion and separation
 * always win when masks overlap.
 */
export async function applyRasterGuidance(
  input: ApplyRasterGuidanceInput,
): Promise<AppliedRasterGuidance> {
  const decoded = await decodeRgba(
    input.source,
    "تعذر فك ترميز أصل الطبقة قبل تطبيق القناع.",
  );

  const origin = resolveGuidanceOrigin(input, decoded.info);
  const excludeMask = new Uint8Array(
    decoded.info.width * decoded.info.height,
  );
  const separateMask = new Uint8Array(
    decoded.info.width * decoded.info.height,
  );
  const includeMask = new Uint8Array(
    decoded.info.width * decoded.info.height,
  );
  const warnings: string[] = [];
  for (const stroke of input.strokes) {
    paintStrokeMask(
      stroke.kind === "include"
        ? includeMask
        : stroke.kind === "exclude"
          ? excludeMask
          : separateMask,
      decoded.info.width,
      decoded.info.height,
      input.documentWidth,
      input.documentHeight,
      origin.x,
      origin.y,
      stroke,
    );
  }

  const refinedPixels = Buffer.from(decoded.data);
  const separatedPixels = Buffer.alloc(decoded.data.length);
  let changedPixels = fillTransparentMask(
    decoded.data,
    refinedPixels,
    includeMask,
    decoded.info.width,
    decoded.info.height,
    warnings,
  );
  let separatedPixelsCount = 0;
  let excludedPixelsCount = 0;
  for (let pixel = 0; pixel < excludeMask.length; pixel += 1) {
    const offset = pixel * 4;
    const alpha = decoded.data[offset + 3] ?? 0;
    if (alpha === 0) continue;
    if (separateMask[pixel]) {
      decoded.data.copy(
        separatedPixels,
        offset,
        offset,
        offset + 4,
      );
      refinedPixels[offset + 3] = 0;
      changedPixels += 1;
      separatedPixelsCount += 1;
      continue;
    }
    if (excludeMask[pixel]) {
      refinedPixels[offset + 3] = 0;
      changedPixels += 1;
      excludedPixelsCount += 1;
    }
  }
  if (
    separatedPixelsCount > 0 &&
    (input.autoFillPolicy ?? "automatic") !== "off"
  ) {
    const fillSource = Buffer.from(refinedPixels);
    const filled = fillTransparentMask(
      fillSource,
      refinedPixels,
      separateMask,
      decoded.info.width,
      decoded.info.height,
      warnings,
    );
    if (filled < separatedPixelsCount) {
      warnings.push("separate_background_fill_incomplete");
    }
    if ((input.autoFillPolicy ?? "automatic") === "review") {
      warnings.push("separate_background_fill_requires_review");
    }
  }
  if (input.strokes.some((stroke) => stroke.kind === "separate") &&
      separatedPixelsCount === 0) {
    warnings.push("separate_mask_has_no_visible_pixels");
  }
  if (input.strokes.some((stroke) => stroke.kind === "exclude") &&
      excludedPixelsCount === 0) {
    warnings.push("exclude_mask_has_no_visible_pixels");
  }
  if (changedPixels === 0) {
    return {
      refined: input.source,
      separated: null,
      changed: false,
      warnings,
    };
  }

  const encode = (pixels: Buffer) =>
    sharp(pixels, {
      raw: {
        width: decoded.info.width,
        height: decoded.info.height,
        channels: 4,
      },
    })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
  const refined = await encode(refinedPixels);
  const separated =
    separatedPixelsCount > 0 ? await encode(separatedPixels) : null;
  return { refined, separated, changed: true, warnings };
}

function fillTransparentMask(
  sourcePixels: Buffer,
  targetPixels: Buffer,
  mask: Uint8Array,
  width: number,
  height: number,
  warnings: string[],
): number {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let transparentTargets = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (alphaAt(sourcePixels, index) === 0) transparentTargets += 1;
  }
  if (maxX < minX) return 0;
  if (transparentTargets === 0) {
    warnings.push("include_mask_has_no_transparent_pixels");
    return 0;
  }

  const left = Math.max(0, minX - GUIDED_FILL_SEARCH_PADDING);
  const top = Math.max(0, minY - GUIDED_FILL_SEARCH_PADDING);
  const right = Math.min(width - 1, maxX + GUIDED_FILL_SEARCH_PADDING);
  const bottom = Math.min(height - 1, maxY + GUIDED_FILL_SEARCH_PADDING);
  const regionWidth = right - left + 1;
  const regionHeight = bottom - top + 1;
  const regionPixels = regionWidth * regionHeight;
  if (regionPixels > MAX_GUIDED_FILL_REGION_PIXELS) {
    warnings.push("include_fill_region_too_large");
    return 0;
  }

  const nearestSource = new Int32Array(regionPixels);
  nearestSource.fill(-1);
  const queue = new Int32Array(regionPixels);
  let read = 0;
  let write = 0;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const sourceIndex = y * width + x;
      if (alphaAt(sourcePixels, sourceIndex) === 0) continue;
      const local = (y - top) * regionWidth + (x - left);
      nearestSource[local] = sourceIndex;
      queue[write++] = local;
    }
  }
  if (write === 0) {
    warnings.push("include_mask_has_no_visible_source_nearby");
    return 0;
  }

  while (read < write) {
    const local = queue[read++]!;
    const x = local % regionWidth;
    const y = Math.floor(local / regionWidth);
    const neighbors = [
      x > 0 ? local - 1 : -1,
      x + 1 < regionWidth ? local + 1 : -1,
      y > 0 ? local - regionWidth : -1,
      y + 1 < regionHeight ? local + regionWidth : -1,
    ];
    for (const neighbor of neighbors) {
      if (neighbor < 0 || nearestSource[neighbor] !== -1) continue;
      nearestSource[neighbor] = nearestSource[local]!;
      queue[write++] = neighbor;
    }
  }

  let filled = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const sourceIndex = y * width + x;
      if (!mask[sourceIndex] || alphaAt(sourcePixels, sourceIndex) !== 0) {
        continue;
      }
      const local = (y - top) * regionWidth + (x - left);
      const nearest = nearestSource[local] ?? -1;
      if (nearest < 0) continue;
      const sourceOffset = nearest * 4;
      const targetOffset = sourceIndex * 4;
      targetPixels[targetOffset] = sourcePixels[sourceOffset] ?? 0;
      targetPixels[targetOffset + 1] = sourcePixels[sourceOffset + 1] ?? 0;
      targetPixels[targetOffset + 2] = sourcePixels[sourceOffset + 2] ?? 0;
      targetPixels[targetOffset + 3] =
        sourcePixels[sourceOffset + 3] ?? 255;
      filled += 1;
    }
  }
  if (filled === 0) warnings.push("include_mask_fill_produced_no_pixels");
  return filled;
}

function resolveGuidanceOrigin(
  input: ApplyRasterGuidanceInput,
  decoded: { width: number; height: number },
): { x: number; y: number } {
  if (
    decoded.width === input.documentWidth &&
    decoded.height === input.documentHeight
  ) {
    return { x: 0, y: 0 };
  }
  const bounds = input.layerBounds;
  if (
    !bounds ||
    Math.round(bounds.width) !== decoded.width ||
    Math.round(bounds.height) !== decoded.height
  ) {
    throw new MediaProcessingError(
      "IMAGE_GUIDANCE_ASSET_MISMATCH",
      "أبعاد أصل الطبقة لا تطابق موضعها داخل مساحة العمل.",
    );
  }
  return { x: Math.round(bounds.x), y: Math.round(bounds.y) };
}

function paintStrokeMask(
  mask: Uint8Array,
  width: number,
  height: number,
  documentWidth: number,
  documentHeight: number,
  originX: number,
  originY: number,
  stroke: ImageGuidanceStroke,
): void {
  const points = stroke.points.map((point) => ({
    x: point.x * Math.max(1, documentWidth - 1) - originX,
    y: point.y * Math.max(1, documentHeight - 1) - originY,
  }));
  const radius = Math.max(1, stroke.brushSize / 2);
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(end.x - start.x, end.y - start.y)),
    );
    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      paintCircle(
        mask,
        width,
        height,
        start.x + (end.x - start.x) * progress,
        start.y + (end.y - start.y) * progress,
        radius,
      );
    }
  }
}

function paintCircle(
  mask: Uint8Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  const left = Math.max(0, Math.floor(centerX - radius));
  const right = Math.min(width - 1, Math.ceil(centerX + radius));
  const top = Math.max(0, Math.floor(centerY - radius));
  const bottom = Math.min(height - 1, Math.ceil(centerY + radius));
  const squaredRadius = radius * radius;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const distance =
        (x - centerX) * (x - centerX) +
        (y - centerY) * (y - centerY);
      if (distance <= squaredRadius) mask[y * width + x] = 255;
    }
  }
}
