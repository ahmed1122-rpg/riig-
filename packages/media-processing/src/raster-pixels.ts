import sharp from "sharp";
import { MediaProcessingError } from "./media-processing-types.js";

const MAX_DECODED_PIXELS = 25_000_000;

export interface DecodedRgba {
  data: Buffer;
  info: { width: number; height: number };
}

export function alphaAt(
  pixels: Buffer,
  pixelIndex: number,
): number {
  return pixels[pixelIndex * 4 + 3] ?? 0;
}

export async function decodeRgba(
  source: Buffer,
  errorMessage: string,
): Promise<DecodedRgba> {
  try {
    return await sharp(source, {
      failOn: "error",
      limitInputPixels: MAX_DECODED_PIXELS,
    })
      .toColourspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new MediaProcessingError(
      "IMAGE_DECODE_FAILED",
      errorMessage,
    );
  }
}

export function forEachNeighbor(
  x: number,
  y: number,
  width: number,
  height: number,
  visit: (index: number, x: number, y: number) => void,
): void {
  const minX = Math.max(0, x - 1);
  const maxX = Math.min(width - 1, x + 1);
  const minY = Math.max(0, y - 1);
  const maxY = Math.min(height - 1, y + 1);
  for (
    let neighborY = minY;
    neighborY <= maxY;
    neighborY += 1
  ) {
    const rowOffset = neighborY * width;
    for (
      let neighborX = minX;
      neighborX <= maxX;
      neighborX += 1
    ) {
      if (neighborX === x && neighborY === y) continue;
      visit(
        rowOffset + neighborX,
        neighborX,
        neighborY,
      );
    }
  }
}
