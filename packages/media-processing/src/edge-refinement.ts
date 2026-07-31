import sharp from "sharp";
import { MediaProcessingError } from "./media-processing-types.js";

export interface RasterEdgeRefinementOptions {
  radius: 1 | 2 | 3;
  strength: number;
}

/**
 * Smooths and gently increases the contrast of the alpha boundary while
 * preserving every RGB sample. The caller stores the returned PNG as a new
 * revision, so the source raster remains recoverable.
 */
export async function refineRasterEdges(
  source: Buffer,
  options: RasterEdgeRefinementOptions,
): Promise<Buffer> {
  const strength = Math.min(1, Math.max(0, options.strength));
  if (![1, 2, 3].includes(options.radius) || strength <= 0) {
    throw new MediaProcessingError(
      "IMAGE_GUIDANCE_ASSET_MISMATCH",
      "Edge refinement requires a radius from 1 to 3 and positive strength.",
    );
  }
  const decoded = await sharp(source, { failOn: "error" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = decoded.info;
  if (!width || !height || channels !== 4) {
    throw new MediaProcessingError(
      "IMAGE_DECODE_FAILED",
      "The raster layer could not be decoded for edge refinement.",
    );
  }
  const alpha = Buffer.alloc(width * height);
  for (let index = 0; index < alpha.length; index += 1) {
    alpha[index] = decoded.data[index * 4 + 3]!;
  }
  const smoothed = await sharp(alpha, {
    raw: { width, height, channels: 1 },
  })
    .blur(options.radius)
    .raw()
    .toBuffer();
  const output = Buffer.from(decoded.data);
  const contrast = 1 + strength * 0.35;
  for (let index = 0; index < alpha.length; index += 1) {
    const emphasized = clampByte(128 + (smoothed[index]! - 128) * contrast);
    output[index * 4 + 3] = clampByte(
      alpha[index]! * (1 - strength) + emphasized * strength,
    );
  }
  return sharp(output, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
