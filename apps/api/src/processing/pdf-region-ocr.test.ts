import type { LayerDocument } from "@motionprep/contracts";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  applyPdfRegionOcr,
  PdfRegionOcrError,
} from "./pdf-region-ocr.js";

const projectId = "00000000-0000-4000-8000-000000000101";
const sourceVersionId = "00000000-0000-4000-8000-000000000102";
const actorUserId = "00000000-0000-4000-8000-000000000103";

describe("applyPdfRegionOcr", () => {
  it("replaces only materially overlapping text and records recoverable history", async () => {
    const source = await createPdf();
    const result = await applyPdfRegionOcr({
      source,
      document: createDocument(),
      operation: {
        pageNumber: 1,
        start: { x: 0.4, y: 0.05 },
        end: { x: 0.95, y: 0.13 },
        baseRevision: 1,
        actorUserId,
        operationId: "regional-ocr-operation-001",
      },
      ocrEngine: {
        async recognizePage(input) {
          expect((await sharp(input.image).metadata()).format).toBe("png");
          expect(input.width).toBeCloseTo(550);
          expect(input.height).toBeCloseTo(112);
          return [
            {
              text: "نص مصحح",
              bounds: { x: 100, y: 30, width: 200, height: 40 },
              confidence: 0.94,
              direction: "rtl",
            },
          ];
        },
      },
      now: () => new Date("2026-07-30T18:00:00.000Z"),
    });

    expect(result.document.revision).toBe(2);
    expect(result.affectedLayerIds).toEqual(["text-a"]);
    expect(result.removedLayerIds).toEqual(["text-a"]);
    expect(result.createdLayerIds).toHaveLength(1);
    expect(
      result.document.layers.find(
        (layer) => layer.id === result.createdLayerIds[0],
      ),
    ).toMatchObject({
      fullText: "نص مصحح",
      bounds: { x: 500, y: 100, width: 200, height: 40 },
      pageNumber: 1,
      direction: "rtl",
      confidence: 0.94,
    });
    expect(result.document.layers.some((layer) => layer.id === "text-b")).toBe(
      true,
    );
    expect(result.document.editTimeline?.entries.at(-1)).toMatchObject({
      operationId: "regional-ocr-operation-001",
      kind: "pdf-region-ocr",
      revision: 2,
      affectedLayerIds: ["text-a"],
      removedLayerIds: ["text-a"],
    });
  });

  it("rejects stale revisions before invoking OCR", async () => {
    let called = false;
    await expect(
      applyPdfRegionOcr({
        source: await createPdf(),
        document: createDocument(),
        operation: {
          pageNumber: 1,
          start: { x: 0.4, y: 0.05 },
          end: { x: 0.95, y: 0.13 },
          baseRevision: 2,
          actorUserId,
          operationId: "regional-ocr-stale-001",
        },
        ocrEngine: {
          async recognizePage() {
            called = true;
            return [];
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "DOCUMENT_REVISION_CONFLICT",
    } satisfies Partial<PdfRegionOcrError>);
    expect(called).toBe(false);
  });
});

async function createPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.addPage([1000, 1400]);
  return Buffer.from(await pdf.save());
}

function createDocument(): LayerDocument {
  return {
    schemaVersion: "1.0",
    projectId,
    sourceVersionId,
    revision: 1,
    generatedAt: "2026-07-30T16:00:00.000Z",
    width: 1000,
    height: 1400,
    colorSpace: "sRGB",
    pages: [{ pageNumber: 1, width: 1000, height: 1400 }],
    layers: [
      {
        id: "background",
        parentId: null,
        kind: "raster",
        name: "+page_001_background",
        visible: true,
        locked: true,
        opacity: 1,
        fixed: true,
        zIndex: 0,
        pageNumber: 1,
        bounds: { x: 0, y: 0, width: 1000, height: 1400 },
      },
      textLayer("text-a", "نص قديم", 100, 0),
      textLayer("text-b", "سطر باق", 180, 1),
    ],
  };
}

function textLayer(
  id: string,
  text: string,
  y: number,
  readingOrder: number,
) {
  return {
    id,
    parentId: null,
    kind: "text" as const,
    name: `+${id}` as `+${string}`,
    visible: true,
    locked: false,
    opacity: 1,
    fixed: false,
    zIndex: readingOrder + 1,
    fullText: text,
    pageNumber: 1,
    bounds: { x: 500, y, width: 400, height: 60 },
    readingOrder,
    direction: "rtl" as const,
  };
}
