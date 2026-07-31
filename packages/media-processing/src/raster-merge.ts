import sharp from "sharp";
import type { LayerBounds } from "@motionprep/contracts";
import { MediaProcessingError } from "./media-processing-types.js";

export interface RasterMergeInput {
  source: Buffer;
  bounds: LayerBounds;
  opacity: number;
  zIndex: number;
}

export async function mergeRasterLayers(input: {
  bounds: LayerBounds;
  layers: readonly RasterMergeInput[];
}): Promise<Buffer> {
  const width = Math.round(input.bounds.width);
  const height = Math.round(input.bounds.height);
  if (
    width <= 0 ||
    height <= 0 ||
    input.layers.length < 2 ||
    width * height > 16_777_216
  ) {
    throw new MediaProcessingError(
      "IMAGE_GUIDANCE_ASSET_MISMATCH",
      "Raster merge bounds or layer count are invalid.",
    );
  }
  const composite = await Promise.all(
    [...input.layers]
      .sort((left, right) => left.zIndex - right.zIndex)
      .map(async (layer) => ({
        input: await prepareLayer(layer),
        left: Math.round(layer.bounds.x - input.bounds.x),
        top: Math.round(layer.bounds.y - input.bounds.y),
        blend: "over" as const,
      })),
  );
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composite)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function prepareLayer(layer: RasterMergeInput): Promise<Buffer> {
  const width = Math.max(1, Math.round(layer.bounds.width));
  const height = Math.max(1, Math.round(layer.bounds.height));
  const decoded = await sharp(layer.source, { failOn: "error" })
    .ensureAlpha()
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const opacity = Math.min(1, Math.max(0, layer.opacity));
  for (let index = 3; index < decoded.data.length; index += 4) {
    decoded.data[index] = Math.round(decoded.data[index]! * opacity);
  }
  return sharp(decoded.data, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
}
