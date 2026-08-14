import sharp from "sharp";
import Tesseract from "tesseract.js";
import { describe, expect, it } from "vitest";
import {
  OCR_SELECTOR_PIPELINES,
  ocrSegmentationMode,
  prepareOcrImage,
} from "./ocr-pipeline.js";

describe("OCR pipeline contract", () => {
  it("keeps the selector candidate grid explicit and unique", () => {
    expect(OCR_SELECTOR_PIPELINES).toHaveLength(10);
    expect(Object.isFrozen(OCR_SELECTOR_PIPELINES)).toBe(true);
    expect(OCR_SELECTOR_PIPELINES.every(Object.isFrozen)).toBe(true);
    expect(
      new Set(OCR_SELECTOR_PIPELINES.map((pipeline) => pipeline.id)).size,
    ).toBe(OCR_SELECTOR_PIPELINES.length);
    expect(OCR_SELECTOR_PIPELINES[0]).toEqual({
      id: "auto-normalize",
      segmentation: "auto",
      preprocessing: "normalize",
    });
    expect(OCR_SELECTOR_PIPELINES).toContainEqual({
      id: "auto-trim-sharpen",
      segmentation: "auto",
      preprocessing: "trim-sharpen",
    });
  });

  it("maps named segmentation policies to Tesseract modes", () => {
    expect(ocrSegmentationMode("auto")).toBe(Tesseract.PSM.AUTO);
    expect(ocrSegmentationMode("single-column")).toBe(
      Tesseract.PSM.SINGLE_COLUMN,
    );
    expect(ocrSegmentationMode("single-block")).toBe(
      Tesseract.PSM.SINGLE_BLOCK,
    );
    expect(ocrSegmentationMode("sparse-text")).toBe(
      Tesseract.PSM.SPARSE_TEXT,
    );
    expect(() => ocrSegmentationMode("invalid" as never)).toThrow(
      /Unsupported OCR segmentation/u,
    );
  });

  it("returns normalized image geometry with zero offsets", async () => {
    const source = await sharp({
      create: {
        width: 24,
        height: 16,
        channels: 3,
        background: "#d0d0d0",
      },
    })
      .png()
      .toBuffer();

    const prepared = await prepareOcrImage(source, "normalize");

    expect(prepared.data).toBeInstanceOf(Buffer);
    expect(prepared.info).toEqual({
      width: 24,
      height: 16,
      offsetX: 0,
      offsetY: 0,
    });
    await expect(
      prepareOcrImage(source, "invalid" as never),
    ).rejects.toThrow(/Unsupported OCR preprocessing/u);
  });
});
