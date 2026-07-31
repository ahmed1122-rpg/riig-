import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  applyRasterGuidance,
  MediaProcessingError,
  prepareImageSource,
  type PreparedImageSource,
} from "./index.js";

const fixedNow = () => new Date("2026-07-27T00:00:00.000Z");

function sequentialIds(): () => string {
  let value = 0;
  return () => `layer-${++value}`;
}

describe("prepareImageSource", () => {
  it("normalizes an opaque image into one independently stored source asset", async () => {
    const source = await sharp({
      create: {
        width: 320,
        height: 180,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const result = await prepareImageSource(
      {
        projectId: "project-1",
        sourceVersionId: "source-1",
        source,
      },
      fixedNow,
      sequentialIds(),
    );

    expect(result.document.width).toBe(320);
    expect(result.document.height).toBe(180);
    expect(result.document.layers).toHaveLength(1);
    expect(result.document.layers[0]?.name).toBe("+source");
    expect(result.document.generatedAt).toBe("2026-07-27T00:00:00.000Z");
    expect(result.document.imagePreparation).toEqual({
      strategy: "single-source",
      detectedComponents: 0,
      outputLayers: 1,
      overflowMerged: false,
      fallbackReason: "opaque-source",
    });
    expect(result.rasterAssets).toHaveLength(1);
    const asset = result.rasterAssets[0]!;
    expect(asset.objectKey).toBe(
      "derived/project-1/source-1/layers/layer-1.png",
    );
    expect(asset.sha256).toBe(
      createHash("sha256").update(asset.body).digest("hex"),
    );
    expect(result.document.layers[0]?.rasterAsset).toEqual({
      objectKey: asset.objectKey,
      contentType: "image/png",
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
    });
  });

  it("decodes an AVIF source into the same normalized raster contract", async () => {
    const source = await sharp({
      create: {
        width: 24,
        height: 16,
        channels: 3,
        background: { r: 80, g: 120, b: 200 },
      },
    })
      .avif()
      .toBuffer();

    const result = await prepareImageSource(
      {
        projectId: "project-avif",
        sourceVersionId: "source-avif",
        source,
      },
      fixedNow,
      sequentialIds(),
    );

    expect(result.document).toMatchObject({
      width: 24,
      height: 16,
      imagePreparation: {
        strategy: "single-source",
        fallbackReason: "opaque-source",
      },
    });
    expect(result.rasterAssets[0]?.contentType).toBe("image/png");
  });

  it("extracts disconnected alpha islands into real cropped raster assets", async () => {
    const pixels = Buffer.alloc(12 * 8 * 4);
    paintRect(pixels, 12, 1, 1, 2, 2, [255, 0, 0, 255]);
    paintRect(pixels, 12, 7, 1, 3, 2, [0, 255, 0, 200]);
    paintRect(pixels, 12, 4, 6, 1, 1, [0, 0, 255, 255]);
    const source = await sharp(pixels, {
      raw: { width: 12, height: 8, channels: 4 },
    })
      .png()
      .toBuffer();

    const result = await prepareImageSource(
      {
        projectId: "project-1",
        sourceVersionId: "source-1",
        source,
      },
      fixedNow,
      sequentialIds(),
    );

    expect(result.document.imagePreparation).toEqual({
      strategy: "alpha-components",
      detectedComponents: 3,
      outputLayers: 3,
      overflowMerged: false,
    });
    expect(result.document.layers.map((layer) => layer.bounds)).toEqual([
      { x: 7, y: 1, width: 3, height: 2 },
      { x: 1, y: 1, width: 2, height: 2 },
      { x: 4, y: 6, width: 1, height: 1 },
    ]);
    expect(result.rasterAssets).toHaveLength(3);
    expect(await reconstruct(result)).toEqual(pixels);
  });

  it("keeps anti-aliased fringe pixels without merging opaque components", async () => {
    const width = 10;
    const height = 3;
    const pixels = Buffer.alloc(width * height * 4);
    paintRect(pixels, width, 0, 0, 3, 3, [220, 30, 30, 255]);
    paintRect(pixels, width, 7, 0, 3, 3, [30, 80, 220, 255]);
    paintRect(pixels, width, 3, 1, 4, 1, [128, 128, 128, 1]);
    const source = await sharp(pixels, {
      raw: { width, height, channels: 4 },
    })
      .png()
      .toBuffer();

    const result = await prepareImageSource(
      {
        projectId: "project-edge",
        sourceVersionId: "source-edge",
        source,
      },
      fixedNow,
      sequentialIds(),
    );

    expect(result.document.imagePreparation).toMatchObject({
      strategy: "alpha-components",
      detectedComponents: 2,
      outputLayers: 2,
    });
    expect(await reconstruct(result)).toEqual(pixels);
  });

  it("keeps every visible pixel while merging component overflow at 15 layers", async () => {
    const width = 32;
    const height = 1;
    const pixels = Buffer.alloc(width * height * 4);
    for (let index = 0; index < 16; index += 1) {
      paintRect(
        pixels,
        width,
        index * 2,
        0,
        1,
        1,
        [index, 100, 200, 255],
      );
    }
    const source = await sharp(pixels, {
      raw: { width, height, channels: 4 },
    })
      .png()
      .toBuffer();

    const result = await prepareImageSource(
      {
        projectId: "project-1",
        sourceVersionId: "source-1",
        source,
      },
      fixedNow,
      sequentialIds(),
    );

    expect(result.document.layers).toHaveLength(15);
    expect(result.document.layers.at(-1)?.name).toBe("+تفاصيل_مجمعة");
    expect(result.document.imagePreparation).toMatchObject({
      detectedComponents: 16,
      outputLayers: 15,
      overflowMerged: true,
    });
    expect(await reconstruct(result)).toEqual(pixels);
  });

  it("rejects a fully transparent image instead of creating an empty layer", async () => {
    const source = await sharp({
      create: {
        width: 20,
        height: 10,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();

    await expect(
      prepareImageSource({
        projectId: "project-1",
        sourceVersionId: "source-1",
        source,
      }),
    ).rejects.toMatchObject({
      code: "IMAGE_HAS_NO_VISIBLE_PIXELS",
    });
  });

  it("rejects bytes that only imitate an image signature", async () => {
    await expect(
      prepareImageSource({
        projectId: "project-1",
        sourceVersionId: "source-1",
        source: Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]),
      }),
    ).rejects.toBeInstanceOf(MediaProcessingError);
  });
});

describe("applyRasterGuidance", () => {
  it("fills only brushed transparent gaps from nearby visible pixels", async () => {
    const pixels = Buffer.alloc(9 * 9 * 4);
    paintRect(pixels, 9, 1, 1, 7, 7, [30, 140, 220, 255]);
    paintRect(pixels, 9, 3, 3, 3, 3, [0, 0, 0, 0]);
    const source = await sharp(pixels, {
      raw: { width: 9, height: 9, channels: 4 },
    })
      .png()
      .toBuffer();

    const result = await applyRasterGuidance({
      source,
      documentWidth: 9,
      documentHeight: 9,
      strokes: [
        {
          id: "stroke-fill-gap",
          targetLayerId: "source",
          kind: "include",
          brushSize: 5,
          points: [
            { x: 0.5, y: 0.35 },
            { x: 0.5, y: 0.65 },
          ],
          createdAt: "2026-07-28T00:00:00.000Z",
        },
      ],
    });

    const refined = await sharp(result.refined)
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect(result.changed).toBe(true);
    expect(result.warnings).not.toContain(
      "include_strokes_saved_for_semantic_adapter",
    );
    expect(refined[(4 * 9 + 4) * 4 + 3]).toBe(255);
    expect(refined[(0 * 9 + 0) * 4 + 3]).toBe(0);
  });

  it("separates painted pixels into a new raster without losing visible pixels", async () => {
    const source = await sharp({
      create: {
        width: 20,
        height: 10,
        channels: 4,
        background: { r: 220, g: 40, b: 40, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const result = await applyRasterGuidance({
      source,
      documentWidth: 20,
      documentHeight: 10,
      autoFillPolicy: "review",
      strokes: [
        {
          id: "stroke-separate",
          targetLayerId: "source",
          kind: "separate",
          brushSize: 4,
          points: [
            { x: 0.5, y: 0.1 },
            { x: 0.5, y: 0.9 },
          ],
          createdAt: "2026-07-28T00:00:00.000Z",
        },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.separated).not.toBeNull();
    const refined = await sharp(result.refined).ensureAlpha().raw().toBuffer();
    const separated = await sharp(result.separated!)
      .ensureAlpha()
      .raw()
      .toBuffer();
    let refinedVisible = 0;
    let separatedVisible = 0;
    for (let offset = 3; offset < refined.length; offset += 4) {
      if (refined[offset]) refinedVisible += 1;
      if (separated[offset]) separatedVisible += 1;
    }
    expect(separatedVisible).toBeGreaterThan(0);
    expect(refinedVisible).toBe(200);
    expect(refinedVisible + separatedVisible).toBeGreaterThan(200);
    expect(result.warnings).toContain(
      "separate_background_fill_requires_review",
    );
  });
});

function paintRect(
  pixels: Buffer,
  canvasWidth: number,
  left: number,
  top: number,
  width: number,
  height: number,
  color: readonly [number, number, number, number],
): void {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      const offset = (y * canvasWidth + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3];
    }
  }
}

async function reconstruct(result: PreparedImageSource): Promise<Buffer> {
  const output = Buffer.alloc(
    result.document.width * result.document.height * 4,
  );
  for (const layer of result.document.layers) {
    const asset = result.rasterAssets.find(
      (candidate) => candidate.layerId === layer.id,
    )!;
    const decoded = await sharp(asset.body)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const left = layer.bounds?.x ?? 0;
    const top = layer.bounds?.y ?? 0;
    for (let y = 0; y < decoded.info.height; y += 1) {
      for (let x = 0; x < decoded.info.width; x += 1) {
        const sourceOffset = (y * decoded.info.width + x) * 4;
        if (decoded.data[sourceOffset + 3] === 0) continue;
        const outputOffset =
          ((top + y) * result.document.width + left + x) * 4;
        decoded.data.copy(
          output,
          outputOffset,
          sourceOffset,
          sourceOffset + 4,
        );
      }
    }
  }
  return output;
}
