import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  DocumentProcessingError,
  LocalArabicPdfOcrEngine,
  preparePdfSource,
  renderPdfRegion,
  type PdfOcrEngine,
} from "./index.js";

async function createTextPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([400, 300]);
  page.drawText("Motion title", {
    x: 40,
    y: 250,
    size: 24,
    font,
    color: rgb(0, 0, 0),
  });
  page.drawText("First sentence. Second sentence!", {
    x: 40,
    y: 210,
    size: 12,
    font,
    color: rgb(0, 0, 0),
  });
  return Buffer.from(await pdf.save());
}

async function createRasterPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 300]);
  const pixel = await pdf.embedPng(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lp9Z9QAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  page.drawImage(pixel, { x: 0, y: 0, width: 400, height: 300 });
  return Buffer.from(await pdf.save());
}

async function createArabicOcrFixturePdf(
  width = 800,
  height = 450,
): Promise<Buffer> {
  const image = await readFile(
    new URL(
      "../../../artifacts/benchmarks/ocr-arabic/page.png",
      import.meta.url,
    ),
  );
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([width, height]);
  const embeddedImage = await pdf.embedPng(image);
  page.drawImage(embeddedImage, {
    x: 0,
    y: 0,
    width,
    height,
  });
  return Buffer.from(await pdf.save());
}

describe("preparePdfSource", () => {
  it("renders only the selected PDF rectangle for regional OCR", async () => {
    const rendered = await renderPdfRegion({
      source: await createTextPdf(),
      pageNumber: 1,
      start: { x: 0.25, y: 0.2 },
      end: { x: 0.75, y: 0.8 },
    });
    const metadata = await sharp(rendered.image).metadata();

    expect(rendered).toMatchObject({
      pageNumber: 1,
      pageWidth: 400,
      pageHeight: 300,
      renderScale: 4,
    });
    expect(rendered.bounds.x).toBeCloseTo(100);
    expect(rendered.bounds.y).toBeCloseTo(60);
    expect(rendered.bounds.width).toBeCloseTo(200);
    expect(rendered.bounds.height).toBeCloseTo(180);
    expect(metadata).toMatchObject({
      format: "png",
      width: 800,
      height: 720,
    });
  });

  it("creates a fixed white background and positioned sentence layers", async () => {
    const document = await preparePdfSource(
      {
        projectId: "project-1",
        sourceVersionId: "source-1",
        source: await createTextPdf(),
        separationMode: "sentence",
      },
      () => new Date("2026-07-28T12:00:00.000Z"),
    );

    expect(document.pages).toEqual([
      { pageNumber: 1, width: 400, height: 300 },
    ]);
    expect(document.layers[0]).toMatchObject({
      name: "+page_001_background",
      locked: true,
      fixed: true,
      fillColor: "#ffffff",
      pageNumber: 1,
    });
    const textLayers = document.layers.filter((layer) => layer.kind === "text");
    expect(textLayers.map((layer) => layer.fullText)).toEqual([
      "Motion title",
      "First sentence.",
      "Second sentence!",
    ]);
    expect(textLayers.every((layer) => layer.bounds)).toBe(true);
    expect(textLayers.map((layer) => layer.readingOrder)).toEqual([0, 1, 2]);
  });

  it("requires OCR instead of silently dropping scanned pages", async () => {
    await expect(
      preparePdfSource({
        projectId: "project-1",
        sourceVersionId: "source-1",
        source: await createRasterPdf(),
        separationMode: "line",
      }),
    ).rejects.toMatchObject({
      code: "OCR_REQUIRED",
      pageNumbers: [1],
    } satisfies Partial<DocumentProcessingError>);
  });

  it("runs positioned local OCR results through the selected separation mode", async () => {
    const calls: number[] = [];
    const ocrEngine: PdfOcrEngine = {
      async recognizePage(input) {
        calls.push(input.pageNumber);
        expect(input.image.subarray(1, 4).toString("ascii")).toBe("PNG");
        expect(input.renderScale).toBeGreaterThanOrEqual(1);
        return [
          {
            text: "عنوان",
            bounds: { x: 250, y: 30, width: 70, height: 24 },
            confidence: 0.91,
            direction: "rtl",
          },
          {
            text: "الكتاب",
            bounds: { x: 175, y: 30, width: 70, height: 24 },
            confidence: 0.87,
            direction: "rtl",
          },
        ];
      },
    };

    const document = await preparePdfSource({
      projectId: "project-1",
      sourceVersionId: "source-1",
      source: await createRasterPdf(),
      separationMode: "word",
      ocrEngine,
    });

    expect(calls).toEqual([1]);
    expect(
      document.layers
        .filter((layer) => layer.kind === "text")
        .map((layer) => ({
          text: layer.fullText,
          confidence: layer.confidence,
          direction: layer.direction,
        })),
    ).toEqual([
      { text: "عنوان", confidence: 0.89, direction: "rtl" },
      { text: "الكتاب", confidence: 0.89, direction: "rtl" },
    ]);
    expect(document.layers[0]).toMatchObject({
      locked: true,
      fixed: true,
      fillColor: "#ffffff",
    });
  });

  it("persists explicit OCR review evidence returned by the engine", async () => {
    const document = await preparePdfSource({
      projectId: "project-1",
      sourceVersionId: "source-1",
      source: await createRasterPdf(),
      separationMode: "line",
      ocrEngine: {
        async recognizePage() {
          return [
            {
              text: "نص يحتاج مراجعة",
              bounds: { x: 120, y: 40, width: 160, height: 25 },
              confidence: 0.3,
              direction: "rtl",
            },
          ];
        },
        getPageReview(pageNumber) {
          return {
            pageNumber,
            status: "needs_review",
            reasons: ["low_confidence"],
            wordCount: 3,
            averageConfidence: 0.3,
            arabicCharacterRatio: 1,
            contentCoverage: 0.12,
            fallbackUsed: true,
          };
        },
      },
    });

    expect(document.ocrReview).toEqual({
      policyVersion: "1.0",
      status: "needs_review",
      pages: [
        {
          pageNumber: 1,
          status: "needs_review",
          reasons: ["low_confidence"],
          wordCount: 3,
          averageConfidence: 0.3,
          arabicCharacterRatio: 1,
          contentCoverage: 0.12,
          fallbackUsed: true,
        },
      ],
    });
  });

  it.each([
    {
      name: "returns no words",
      recognizePage: async () => [],
    },
    {
      name: "throws",
      recognizePage: async () => {
        throw new Error("ocr unavailable");
      },
    },
  ])("reports OCR_FAILED when the OCR engine $name", async ({ recognizePage }) => {
    await expect(
      preparePdfSource({
        projectId: "project-1",
        sourceVersionId: "source-1",
        source: await createRasterPdf(),
        separationMode: "line",
        ocrEngine: { recognizePage },
      }),
    ).rejects.toMatchObject({
      code: "OCR_FAILED",
      pageNumbers: [1],
    } satisfies Partial<DocumentProcessingError>);
  });

  it("groups nearby OCR lines into topics and keeps distant lines separate", async () => {
    const document = await preparePdfSource({
      projectId: "project-1",
      sourceVersionId: "source-1",
      source: await createRasterPdf(),
      separationMode: "topic",
      ocrEngine: {
        async recognizePage() {
          return [
            {
              text: "سطر أول",
              bounds: { x: 220, y: 30, width: 110, height: 20 },
              confidence: 0.9,
              direction: "rtl",
            },
            {
              text: "سطر ثان",
              bounds: { x: 215, y: 58, width: 115, height: 20 },
              confidence: 0.8,
              direction: "rtl",
            },
            {
              text: "موضوع جديد",
              bounds: { x: 190, y: 125, width: 140, height: 20 },
              confidence: 0.7,
              direction: "rtl",
            },
          ];
        },
      },
    });
    const textLayers = document.layers.filter(
      (layer) => layer.kind === "text",
    );

    expect(textLayers.map((layer) => layer.fullText)).toEqual([
      "سطر أول\nسطر ثان",
      "موضوع جديد",
    ]);
    expect(textLayers[0]?.confidence).toBeCloseTo(0.85);
    expect(textLayers[1]?.confidence).toBeCloseTo(0.7);
  });

  it.each([
    { width: 800, height: 450 },
    { width: 1600, height: 900 },
  ])(
    "recognizes the bundled Arabic scan fixture through the full PDF path at $width×$height",
    async ({ width, height }) => {
      const completedStages: string[] = [];
      const ocrEngine = new LocalArabicPdfOcrEngine({
        onProgress(event) {
          if (event.progress === 1) {
            completedStages.push(`${event.pageNumber}:${event.status}`);
          }
        },
      });

      try {
        const document = await preparePdfSource({
          projectId: "project-1",
          sourceVersionId: "source-1",
          source: await createArabicOcrFixturePdf(width, height),
          separationMode: "line",
          ocrEngine,
        });
        const textLayers = document.layers.filter(
          (layer) => layer.kind === "text",
        );
        const recognizedText = textLayers
          .map((layer) => layer.fullText)
          .join(" ");

        expect(recognizedText).toBe(
          "هذا كتاب عربي للاختبار الفصل الأول في صناعة الحركة النص واضح ومفيد للقارئ",
        );
        for (const token of [
          "كتاب",
          "عربي",
          "الفصل",
          "صناعة",
          "الحركة",
          "واضح",
          "للقارئ",
        ]) {
          expect(recognizedText).toContain(token);
        }
        expect(textLayers).toHaveLength(3);
        expect(
          textLayers.every(
            (layer) =>
              layer.direction === "rtl" &&
              (layer.confidence ?? 0) >= 0.8 &&
              layer.bounds &&
              layer.bounds.x >= 0 &&
              layer.bounds.y >= 0 &&
              layer.bounds.x + layer.bounds.width <= width &&
              layer.bounds.y + layer.bounds.height <= height,
          ),
        ).toBe(true);
        expect(
          completedStages.some((stage) =>
            stage.startsWith("1:recognizing text"),
          ),
        ).toBe(true);
      } finally {
        await ocrEngine.close();
      }
    },
    30_000,
  );

  it(
    "uses sparse-text fallback when ruled tables defeat automatic segmentation",
    async () => {
      const image = await readFile(
        new URL(
          "../../../artifacts/benchmarks/ocr-arabic-corpus/images/tuhfa-052-table.jpg",
          import.meta.url,
        ),
      );
      const fallbacks: Array<{
        strategy: { preprocessing: string; segmentation: string };
      }> = [];
      const reviews: Array<{
        pageNumber: number;
        reasons: string[];
        averageConfidence: number;
      }> = [];
      const ocrEngine = new LocalArabicPdfOcrEngine({
        onFallback: (event) => fallbacks.push(event),
        onReviewRequired: (review) => reviews.push(review),
      });

      try {
        const items = await ocrEngine.recognizePage({
          pageNumber: 1,
          image,
          width: 960,
          height: 1242,
          renderScale: 1,
        });

        expect(items.length).toBeGreaterThan(20);
        expect(fallbacks).toEqual([
          {
            pageNumber: 1,
            strategy: {
              preprocessing: "normalize",
              segmentation: "sparse-text",
            },
            primary: expect.objectContaining({
              wordCount: expect.any(Number),
              averageConfidence: expect.any(Number),
              arabicCharacterRatio: expect.any(Number),
              contentCoverage: expect.any(Number),
            }),
          },
        ]);
        expect(items.some((item) => item.direction === "rtl")).toBe(true);
        expect(reviews).toEqual([
          expect.objectContaining({
            pageNumber: 1,
            reasons: ["low_confidence"],
            averageConfidence: expect.any(Number),
          }),
        ]);
        expect(ocrEngine.getPageReview(1)).toEqual(reviews[0]);
        expect(
          items.every(
            (item) =>
              item.bounds.width > 0 &&
              item.bounds.height > 0 &&
              item.confidence >= 0 &&
              item.confidence <= 1,
          ),
        ).toBe(true);
      } finally {
        await ocrEngine.close();
      }
    },
    30_000,
  );

  it.each([
    {
      fixture: "poetry-056.jpg",
      preprocessing: "threshold-190",
      segmentation: "single-column",
    },
    {
      fixture: "poetry-144.jpg",
      preprocessing: "trim-sharpen",
      segmentation: "auto",
    },
    {
      fixture: "poetry-187.jpg",
      preprocessing: "median",
      segmentation: "sparse-text",
    },
    {
      fixture: "tuhfa-016-prose.jpg",
      preprocessing: "normalize",
      segmentation: "single-block",
    },
  ])(
    "executes the $preprocessing/$segmentation fallback selected from page evidence",
    async ({ fixture, preprocessing, segmentation }) => {
      const image = await readFile(
        new URL(
          `../../../artifacts/benchmarks/ocr-arabic-corpus/images/${fixture}`,
          import.meta.url,
        ),
      );
      const prepared = await sharp(image)
        .resize({
          width: 1_600,
          height: 1_600,
          fit: "inside",
          withoutEnlargement: false,
          kernel: sharp.kernel.lanczos3,
        })
        .png()
        .toBuffer({ resolveWithObject: true });
      const fallbacks: Array<{
        strategy: { preprocessing: string; segmentation: string };
      }> = [];
      const ocrEngine = new LocalArabicPdfOcrEngine({
        onFallback: (event) => fallbacks.push(event),
      });

      try {
        const items = await ocrEngine.recognizePage({
          pageNumber: 1,
          image: prepared.data,
          width: 960,
          height: 1242,
          renderScale: 1,
        });

        expect(items.length).toBeGreaterThan(0);
        expect(fallbacks).toHaveLength(1);
        expect(fallbacks[0]?.strategy).toEqual({
          preprocessing,
          segmentation,
        });
        expect(
          items.every(
            (item) =>
              item.bounds.x >= 0 &&
              item.bounds.y >= 0 &&
              item.bounds.x + item.bounds.width <= prepared.info.width &&
              item.bounds.y + item.bounds.height <= prepared.info.height,
          ),
        ).toBe(true);
        if (preprocessing === "trim-sharpen") {
          expect(Math.min(...items.map((item) => item.bounds.x))).toBeGreaterThan(
            100,
          );
          expect(Math.min(...items.map((item) => item.bounds.y))).toBeGreaterThan(
            150,
          );
        }
      } finally {
        await ocrEngine.close();
      }
    },
    30_000,
  );

  it(
    "overlays confident local English words on a dense mixed-script page",
    async () => {
      const image = await readFile(
        new URL(
          "../../../artifacts/benchmarks/ocr-arabic-corpus/images/taarib-141-mixed-low-resolution.jpg",
          import.meta.url,
        ),
      );
      const prepared = await sharp(image)
        .resize({
          width: 1_600,
          height: 1_600,
          fit: "inside",
          withoutEnlargement: false,
          kernel: sharp.kernel.lanczos3,
        })
        .png()
        .toBuffer({ resolveWithObject: true });
      const fallbacks: Array<{
        strategy: {
          preprocessing: string;
          segmentation: string;
          latinOverlay?: true;
        };
      }> = [];
      const ocrEngine = new LocalArabicPdfOcrEngine({
        onFallback: (event) => fallbacks.push(event),
      });

      try {
        const items = await ocrEngine.recognizePage({
          pageNumber: 1,
          image: prepared.data,
          width: 500,
          height: 700,
          renderScale: prepared.info.width / 500,
        });
        const texts = items.map((item) => item.text);

        expect(fallbacks).toHaveLength(1);
        expect(fallbacks[0]?.strategy).toEqual({
          preprocessing: "normalize",
          segmentation: "auto",
          latinOverlay: true,
        });
        expect(texts).toContain("Socrate");
        expect(texts.some((text) => text.startsWith("Simplicius"))).toBe(
          true,
        );
        expect(
          items
            .filter((item) => /[A-Za-zÀ-ÿ]/u.test(item.text))
            .every((item) => item.direction === "ltr"),
        ).toBe(true);
      } finally {
        await ocrEngine.close();
      }
    },
    30_000,
  );

  it("preserves a truly blank page without forcing OCR", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([400, 300]);

    const document = await preparePdfSource({
      projectId: "project-1",
      sourceVersionId: "source-1",
      source: Buffer.from(await pdf.save()),
      separationMode: "line",
    });

    expect(document.layers).toHaveLength(1);
    expect(document.layers[0]).toMatchObject({
      name: "+page_001_background",
      locked: true,
      fixed: true,
    });
  });

  it("rejects malformed PDFs with a stable error code", async () => {
    await expect(
      preparePdfSource({
        projectId: "project-1",
        sourceVersionId: "source-1",
        source: Buffer.from("not a pdf"),
        separationMode: "word",
      }),
    ).rejects.toMatchObject({
      code: "PDF_DECODE_FAILED",
    } satisfies Partial<DocumentProcessingError>);
  });

  it("rejects an extreme MediaBox before allocating page or OCR canvases", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([30_001, 10]);
    const source = Buffer.from(await pdf.save());

    await expect(
      preparePdfSource({
        projectId: "project-1",
        sourceVersionId: "source-extreme-media-box",
        source,
        separationMode: "line",
      }),
    ).rejects.toMatchObject({
      code: "PDF_DECODE_FAILED",
      pageNumbers: [1],
    } satisfies Partial<DocumentProcessingError>);
    await expect(
      renderPdfRegion({
        source,
        pageNumber: 1,
        start: { x: 0.1, y: 0.1 },
        end: { x: 0.9, y: 0.9 },
      }),
    ).rejects.toMatchObject({
      code: "PDF_DECODE_FAILED",
      pageNumbers: [1],
    } satisfies Partial<DocumentProcessingError>);
  });

  it("rejects PDFs above the bounded page count before processing pages", async () => {
    const pdf = await PDFDocument.create();
    for (let pageNumber = 0; pageNumber < 251; pageNumber += 1) {
      pdf.addPage([10, 10]);
    }

    await expect(
      preparePdfSource({
        projectId: "project-1",
        sourceVersionId: "source-1",
        source: Buffer.from(await pdf.save()),
        separationMode: "line",
      }),
    ).rejects.toMatchObject({
      code: "PDF_TOO_MANY_PAGES",
    } satisfies Partial<DocumentProcessingError>);
  });
});
