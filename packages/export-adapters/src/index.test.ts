import type { LayerDocument, LayerNode } from "@motionprep/contracts";
import { readPsd } from "ag-psd";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  createLayeredTiff,
  createPdfDocumentPsd,
  createPdfPagePsd,
  createRasterPsd,
  createTransparentPngs,
  ExportAdapterError,
} from "./index.js";

const layer: LayerNode = {
  id: "source-layer",
  parentId: null,
  kind: "raster",
  name: "+المصدر",
  visible: true,
  locked: false,
  opacity: 1,
  fixed: false,
  zIndex: 0,
};

const document: LayerDocument = {
  schemaVersion: "1.0",
  projectId: "project-image",
  sourceVersionId: "source-v1",
  width: 2,
  height: 2,
  colorSpace: "sRGB",
  layers: [layer],
};

async function sourcePng(): Promise<Buffer> {
  return sharp(
    Buffer.from([
      255, 0, 0, 255,
      0, 255, 0, 128,
      0, 0, 255, 64,
      255, 255, 255, 0,
    ]),
    { raw: { width: 2, height: 2, channels: 4 } },
  )
    .png()
    .toBuffer();
}

async function solidPng(
  width: number,
  height: number,
  color: { r: number; g: number; b: number; alpha: number },
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

describe("createRasterPsd", () => {
  it("writes a PSD with a composite bitmap and named raster layer", async () => {
    const source = await sourcePng();
    const result = await createRasterPsd(document, [{ layer, source }]);

    expect(result.subarray(0, 4).toString("ascii")).toBe("8BPS");
    const decoded = readPsd(result, {
      useRawData: true,
      skipThumbnail: true,
    });
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(decoded.children).toHaveLength(1);
    expect(decoded.children?.[0]?.name).toBe("+المصدر");
    expect(decoded.children?.[0]?.hidden).toBe(false);
    expect(decoded.children?.[0]?.rawData?.channels.length).toBeGreaterThan(0);
    expect(decoded.rawCompositeData?.byteLength).toBeGreaterThan(0);
  });

  it("preserves layer visibility and opacity metadata", async () => {
    const source = await sourcePng();
    const hiddenLayer = { ...layer, visible: false, opacity: 0.4 };
    const result = await createRasterPsd(document, [
      { layer: hiddenLayer, source },
    ]);
    const decoded = readPsd(result, {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    });

    expect(decoded.children?.[0]?.hidden).toBe(true);
    expect(decoded.children?.[0]?.opacity).toBeCloseTo(0.4, 2);
  });

  it("rejects dimensions outside the classic PSD limit", async () => {
    const oversized = {
      ...document,
      width: 30_001,
      height: 1,
    };

    await expect(
      createRasterPsd(oversized, [{ layer, source: await sourcePng() }]),
    ).rejects.toMatchObject({
      code: "PSD_DIMENSION_LIMIT_EXCEEDED",
    } satisfies Partial<ExportAdapterError>);
  });

  it("places a cropped layer at its bounds and applies fractional opacity", async () => {
    const croppedLayer: LayerNode = {
      ...layer,
      id: "cropped-layer",
      name: "+cropped",
      opacity: 0.5,
      bounds: { x: 1, y: 1, width: 1, height: 1 },
    };
    const result = await createRasterPsd(
      { ...document, layers: [croppedLayer] },
      [
        {
          layer: croppedLayer,
          source: await solidPng(1, 1, {
            r: 255,
            g: 0,
            b: 0,
            alpha: 255,
          }),
        },
      ],
    );
    const decoded = readPsd(result, {
      skipCompositeImageData: true,
      skipLayerImageData: true,
      skipThumbnail: true,
    });

    expect(decoded.children?.[0]).toMatchObject({
      name: "+cropped",
      left: 1,
      top: 1,
    });
    expect(decoded.children?.[0]?.opacity).toBeCloseTo(0.5, 2);
  });

  it("rejects missing, duplicate, corrupt, and misplaced raster assets", async () => {
    await expect(createRasterPsd(document, [])).rejects.toMatchObject({
      code: "RASTER_LAYER_REQUIRED",
    } satisfies Partial<ExportAdapterError>);
    const source = await sourcePng();
    await expect(
      createRasterPsd(document, [
        { layer, source },
        { layer, source },
      ]),
    ).rejects.toMatchObject({
      code: "RASTER_ASSET_MISMATCH",
    } satisfies Partial<ExportAdapterError>);
    await expect(
      createRasterPsd(document, [
        { layer, source: Buffer.from("not an image") },
      ]),
    ).rejects.toMatchObject({
      code: "RASTER_DECODE_FAILED",
    } satisfies Partial<ExportAdapterError>);
    await expect(
      createRasterPsd(document, [
        {
          layer: {
            ...layer,
            id: "misplaced",
            bounds: { x: 2, y: 2, width: 1, height: 1 },
          },
          source: await solidPng(1, 1, {
            r: 0,
            g: 0,
            b: 0,
            alpha: 255,
          }),
        },
      ]),
    ).rejects.toMatchObject({
      code: "RASTER_ASSET_MISMATCH",
    } satisfies Partial<ExportAdapterError>);
  });

  it("rejects unsafe zero-sized document dimensions", async () => {
    await expect(
      createRasterPsd(
        { ...document, width: 0 },
        [{ layer, source: await sourcePng() }],
      ),
    ).rejects.toMatchObject({
      code: "INVALID_DOCUMENT_DIMENSIONS",
    } satisfies Partial<ExportAdapterError>);
  });
});

describe("createTransparentPngs", () => {
  it("writes full-canvas RGBA PNG files and sanitizes archive names", async () => {
    const source = await sourcePng();
    const unsafeLayer = { ...layer, name: "+head/face" as const };
    const [result] = await createTransparentPngs(document, [
      { layer: unsafeLayer, source },
    ]);

    expect(result?.filename).toBe("01_+head-face.png");
    expect(result?.body.subarray(1, 4).toString("ascii")).toBe("PNG");
    const metadata = await sharp(result?.body).metadata();
    expect(metadata).toMatchObject({
      width: 2,
      height: 2,
      channels: 4,
      format: "png",
    });
  });

  it("falls back to a stable layer filename after removing control characters", async () => {
    const invalidRuntimeLayer = {
      ...layer,
      name: "\u0000",
    } as unknown as LayerNode;
    const [result] = await createTransparentPngs(document, [
      { layer: invalidRuntimeLayer, source: await sourcePng() },
    ]);

    expect(result?.filename).toBe("01_+layer.png");
  });
});

describe("createLayeredTiff", () => {
  it("writes one full-canvas TIFF page for every ordered raster layer", async () => {
    const source = await sourcePng();
    const detailLayer: LayerNode = {
      ...layer,
      id: "detail-layer",
      name: "+تفصيل",
      zIndex: 1,
    };
    const result = await createLayeredTiff(
      { ...document, layers: [layer, detailLayer] },
      [
        { layer, source },
        { layer: detailLayer, source },
      ],
    );
    const metadata = await sharp(result, { pages: -1 }).metadata();

    expect(metadata).toMatchObject({
      format: "tiff",
      width: 2,
      pageHeight: 2,
      pages: 2,
      channels: 4,
    });
  });
});

describe("createPdfPagePsd", () => {
  it("writes independently named text layers above a locked white page", async () => {
    const pdfDocument: LayerDocument = {
      schemaVersion: "1.0",
      projectId: "project-book",
      sourceVersionId: "source-book-v1",
      width: 320,
      height: 180,
      colorSpace: "sRGB",
      pages: [{ pageNumber: 1, width: 320, height: 180 }],
      layers: [
        {
          id: "page-background",
          parentId: null,
          kind: "raster",
          name: "+page_001_background",
          visible: true,
          locked: true,
          opacity: 1,
          fixed: true,
          zIndex: 0,
          pageNumber: 1,
          bounds: { x: 0, y: 0, width: 320, height: 180 },
          fillColor: "#ffffff",
        },
        {
          id: "arabic-heading",
          parentId: null,
          kind: "text",
          name: "+العنوان",
          visible: true,
          locked: false,
          opacity: 1,
          fixed: false,
          zIndex: 1,
          pageNumber: 1,
          fullText: "عنوان عربي",
          direction: "rtl",
          bounds: { x: 40, y: 25, width: 240, height: 42 },
        },
      ],
    };

    const result = await createPdfPagePsd(pdfDocument, 1);
    expect(result.subarray(0, 4).toString("ascii")).toBe("8BPS");
    const decoded = readPsd(result, {
      useRawData: true,
      skipThumbnail: true,
    });

    expect(decoded.width).toBe(320);
    expect(decoded.height).toBe(180);
    expect(decoded.children?.map((child) => child.name)).toEqual([
      "+العنوان",
      "+page_001_background",
    ]);
    expect(decoded.children?.[0]?.rawData?.channels.length).toBeGreaterThan(0);
    expect(decoded.children?.[1]?.protected).toMatchObject({
      position: true,
      composite: true,
      transparency: true,
    });
    expect(decoded.rawCompositeData?.byteLength).toBeGreaterThan(0);
  });

  it("preserves semantic heading groups created by PDF guidance", async () => {
    const document: LayerDocument = {
      schemaVersion: "1.0",
      projectId: "project-book",
      sourceVersionId: "source-book-v1",
      width: 240,
      height: 140,
      colorSpace: "sRGB",
      pages: [{ pageNumber: 1, width: 240, height: 140 }],
      layers: [
        {
          id: "page-background",
          parentId: null,
          kind: "raster",
          name: "+page_001_background",
          visible: true,
          locked: true,
          opacity: 1,
          fixed: true,
          zIndex: 0,
          pageNumber: 1,
          bounds: { x: 0, y: 0, width: 240, height: 140 },
          fillColor: "#ffffff",
        },
        {
          id: "heading-group",
          parentId: null,
          kind: "group",
          name: "+heading_001",
          visible: true,
          locked: false,
          opacity: 1,
          fixed: false,
          zIndex: 2,
          pageNumber: 1,
          bounds: { x: 20, y: 20, width: 200, height: 36 },
        },
        {
          id: "heading-text",
          parentId: "heading-group",
          kind: "text",
          name: "+عنوان_المشهد",
          visible: true,
          locked: false,
          opacity: 1,
          fixed: false,
          zIndex: 1,
          pageNumber: 1,
          fullText: "Scene heading",
          direction: "ltr",
          bounds: { x: 20, y: 20, width: 200, height: 36 },
        },
      ],
    };

    const decoded = readPsd(await createPdfPagePsd(document, 1), {
      useRawData: true,
      skipThumbnail: true,
    });

    expect(decoded.children?.map((child) => child.name)).toEqual([
      "+heading_001",
      "+page_001_background",
    ]);
    expect(decoded.children?.[0]?.children?.map((child) => child.name)).toEqual(
      ["+عنوان_المشهد"],
    );
  });

  it("rejects an unknown page and a page without its fixed white background", async () => {
    const pages = [{ pageNumber: 1, width: 20, height: 20 }];
    const withoutBackground: LayerDocument = {
      ...document,
      width: 20,
      height: 20,
      pages,
      layers: [],
    };

    await expect(createPdfPagePsd(withoutBackground, 2)).rejects.toMatchObject({
      code: "INVALID_DOCUMENT_DIMENSIONS",
    } satisfies Partial<ExportAdapterError>);
    await expect(createPdfPagePsd(withoutBackground, 1)).rejects.toMatchObject({
      code: "RASTER_LAYER_REQUIRED",
    } satisfies Partial<ExportAdapterError>);
  });
});

describe("createPdfDocumentPsd", () => {
  it("stacks pages in named groups with independent locked backgrounds", async () => {
    const pages = [
      { pageNumber: 1, width: 20, height: 10 },
      { pageNumber: 2, width: 30, height: 12 },
    ];
    const layers: LayerNode[] = pages.map((page) => ({
      id: `background-${page.pageNumber}`,
      parentId: null,
      kind: "raster",
      name: `+page_00${page.pageNumber}_background`,
      visible: true,
      locked: true,
      opacity: 1,
      fixed: true,
      zIndex: 0,
      pageNumber: page.pageNumber,
      bounds: { x: 0, y: 0, width: page.width, height: page.height },
      fillColor: "#ffffff",
    }));
    const result = await createPdfDocumentPsd({
      ...document,
      width: 30,
      height: 12,
      pages,
      layers,
    });
    const decoded = readPsd(result, {
      skipCompositeImageData: true,
      skipLayerImageData: true,
      skipThumbnail: true,
    });

    expect(decoded).toMatchObject({ width: 30, height: 22 });
    expect(decoded.children?.map((child) => child.name)).toEqual([
      "+page_001",
      "+page_002",
    ]);
  });

  it("rejects a document with no PDF pages", async () => {
    await expect(
      createPdfDocumentPsd({ ...document, pages: [] }),
    ).rejects.toMatchObject({
      code: "INVALID_DOCUMENT_DIMENSIONS",
    } satisfies Partial<ExportAdapterError>);
  });

  it("rejects an oversized stacked document before allocating page rasters", async () => {
    const pages = Array.from({ length: 31 }, (_, index) => ({
      pageNumber: index + 1,
      width: 1,
      height: 1_000,
    }));
    await expect(
      createPdfDocumentPsd({
        ...document,
        width: 1,
        height: 1_000,
        pages,
        layers: [],
      }),
    ).rejects.toMatchObject({
      code: "PSD_DIMENSION_LIMIT_EXCEEDED",
    } satisfies Partial<ExportAdapterError>);
  });

  it("rejects PDF layer rasters that exceed the aggregate memory budget", async () => {
    const page = { pageNumber: 1, width: 1_000, height: 1_000 };
    const background: LayerNode = {
      ...layer,
      id: "background-1",
      name: "+page_001_background",
      locked: true,
      fixed: true,
      pageNumber: 1,
      bounds: { x: 0, y: 0, width: 1_000, height: 1_000 },
      fillColor: "#ffffff",
    };
    const textLayers: LayerNode[] = Array.from({ length: 50 }, (_, index) => ({
      ...layer,
      id: `text-${index}`,
      kind: "text" as const,
      name: `+text_${index}` as `+${string}`,
      pageNumber: 1,
      fullText: "text",
      bounds: { x: 0, y: 0, width: 1_000, height: 1_000 },
    }));

    await expect(
      createPdfDocumentPsd({
        ...document,
        width: 1_000,
        height: 1_000,
        pages: [page],
        layers: [background, ...textLayers],
      }),
    ).rejects.toMatchObject({
      code: "INVALID_DOCUMENT_DIMENSIONS",
    } satisfies Partial<ExportAdapterError>);
  });
});
