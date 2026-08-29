import sharp from "sharp";
import { MAX_DECODED_PIXELS } from "./document-dimensions.js";
import {
  ExportAdapterError,
  type ExportAdapterErrorCode,
} from "./export-adapter-error.js";

export interface DecodedRgba {
  data: Buffer;
  info: { width: number; height: number };
}

export async function decodeRasterRgba(
  source: Buffer,
  errorCode: ExportAdapterErrorCode,
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
    throw new ExportAdapterError(errorCode, errorMessage);
  }
}

export function transparentCanvas(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
}
