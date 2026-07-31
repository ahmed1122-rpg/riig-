import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { refineRasterEdges } from "./edge-refinement.js";
import { mergeRasterLayers } from "./raster-merge.js";

describe("raster revision tools", () => {
  it("refines alpha edges without changing canvas dimensions", async () => {
    const pixels = Buffer.alloc(5 * 5 * 4);
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        const offset = (y * 5 + x) * 4;
        pixels[offset] = 220;
        pixels[offset + 1] = 120;
        pixels[offset + 2] = 40;
        pixels[offset + 3] = x >= 1 && x <= 3 && y >= 1 && y <= 3 ? 255 : 0;
      }
    }
    const source = await sharp(pixels, {
      raw: { width: 5, height: 5, channels: 4 },
    })
      .png()
      .toBuffer();

    const refined = await refineRasterEdges(source, {
      radius: 1,
      strength: 0.75,
    });
    const decoded = await sharp(refined).ensureAlpha().raw().toBuffer({
      resolveWithObject: true,
    });

    expect(decoded.info).toMatchObject({ width: 5, height: 5, channels: 4 });
    expect(decoded.data).not.toEqual(pixels);
    expect(decoded.data[(2 * 5 + 2) * 4]).toBe(220);
  });

  it("merges raster layers in z order inside their union bounds", async () => {
    const red = await solidPng(2, 2, [255, 0, 0, 255]);
    const blue = await solidPng(2, 2, [0, 0, 255, 255]);

    const merged = await mergeRasterLayers({
      bounds: { x: 0, y: 0, width: 3, height: 2 },
      layers: [
        {
          source: red,
          bounds: { x: 0, y: 0, width: 2, height: 2 },
          opacity: 1,
          zIndex: 1,
        },
        {
          source: blue,
          bounds: { x: 1, y: 0, width: 2, height: 2 },
          opacity: 1,
          zIndex: 2,
        },
      ],
    });
    const decoded = await sharp(merged).ensureAlpha().raw().toBuffer({
      resolveWithObject: true,
    });

    expect(decoded.info).toMatchObject({ width: 3, height: 2, channels: 4 });
    expect([...decoded.data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...decoded.data.subarray(4, 8)]).toEqual([0, 0, 255, 255]);
    expect([...decoded.data.subarray(8, 12)]).toEqual([0, 0, 255, 255]);
  });
});

function solidPng(
  width: number,
  height: number,
  rgba: [number, number, number, number],
): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels.set(rgba, index);
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}
