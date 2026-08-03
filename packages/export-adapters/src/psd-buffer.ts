import type { PixelData, Psd } from "ag-psd";

export function createPsdImageResources(): NonNullable<Psd["imageResources"]> {
  return {
    pixelAspectRatio: { aspect: 1 },
    resolutionInfo: {
      horizontalResolution: 72,
      horizontalResolutionUnit: "PPI",
      widthUnit: "Inches",
      verticalResolution: 72,
      verticalResolutionUnit: "PPI",
      heightUnit: "Inches",
    },
  };
}

export function pixelData(
  pixels: Uint8Array,
  width: number,
  height: number,
): PixelData {
  return {
    data: Uint8ClampedArray.from(pixels),
    width,
    height,
  };
}

export function withScaledAlpha(pixels: Buffer, opacity: number): Buffer {
  const output = Buffer.from(pixels);
  const alphaScale = clampOpacity(opacity);
  for (let index = 3; index < output.length; index += 4) {
    output[index] = Math.round((output[index] ?? 0) * alphaScale);
  }
  return output;
}

export function clampOpacity(opacity: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(opacity) ? opacity : 1));
}
