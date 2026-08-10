import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import {
  approveCurrentReview,
  createAppTestHarness,
  registerCreator,
} from "./app-test-helpers.js";
import { InMemoryObjectStorage } from "./storage/object-storage.js";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { readPsd } from "ag-psd";
import sharp from "sharp";

const harness = createAppTestHarness();

describe("API — المعالجة ووثائق الطبقات", () => {
  it("processes a decoded image into a persisted LayerDocument", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app);
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "وثيقة طبقات حقيقية", kind: "image" },
    });
    const projectId = projectResponse.json().data.id as string;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const intent = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: { cookie },
      payload: {
        projectId,
        filename: "pixel.png",
        contentType: "image/png",
        sizeBytes: png.byteLength,
      },
    });
    const uploaded = await app.inject({
      method: "PUT",
      url: intent.json().data.uploadUrl,
      headers: { cookie, "content-type": "image/png" },
      payload: png,
    });
    const sourceVersionId = uploaded.json().data.sourceVersionId as string;

    const processed = await app.inject({
      method: "POST",
      url: "/v1/processing/jobs",
      headers: {
        cookie,
        "x-idempotency-key": "process-image-001",
        traceparent:
          "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      },
      payload: { projectId, sourceVersionId },
    });
    const repeated = await app.inject({
      method: "POST",
      url: "/v1/processing/jobs",
      headers: {
        cookie,
        "x-idempotency-key": "process-image-001",
      },
      payload: { projectId, sourceVersionId },
    });
    const observed = await app.inject({
      method: "GET",
      url: `/v1/processing/jobs/${processed.json().data.id}`,
      headers: { cookie },
    });
    const subscription = await app.inject({
      method: "GET",
      url: "/v1/billing/subscription",
      headers: { cookie },
    });
    const document = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/layer-document?sourceVersionId=${sourceVersionId}`,
      headers: { cookie },
    });

    expect(processed.statusCode).toBe(202);
    expect(repeated.json().data.id).toBe(processed.json().data.id);
    expect(processed.json().data.status).toBe("ready");
    for (const publicJob of [processed.json().data, observed.json().data]) {
      expect(publicJob).not.toHaveProperty("correlationId");
      expect(publicJob).not.toHaveProperty("traceContext");
      expect(publicJob).not.toHaveProperty("nextAttemptAt");
      expect(publicJob).not.toHaveProperty("leaseOwner");
      expect(publicJob).not.toHaveProperty("leaseExpiresAt");
    }
    expect(subscription.json().data.usage.jobs).toBe(1);
    expect(subscription.json().data.usage.processingMinutes).toBeGreaterThan(0);
    expect(document.statusCode).toBe(200);
    expect(document.json().data.width).toBe(1);
    expect(document.json().data.height).toBe(1);
    expect(document.json().data.layers[0].name).toBe("+source");
    expect(document.json().data.sourceVersionId).toBe(sourceVersionId);
    expect(document.json().data.layers[0].rasterAsset.sha256).toMatch(
      /^[a-f0-9]{64}$/,
    );
    const assetSha256 = document.json().data.layers[0].rasterAsset.sha256 as string;
    const assetUrl = `/v1/projects/${projectId}/layers/${document.json().data.layers[0].id}/asset?sourceVersionId=${sourceVersionId}&assetSha256=${assetSha256}`;
    const layerAsset = await app.inject({
      method: "GET",
      url: assetUrl,
      headers: { cookie },
    });
    expect(layerAsset.statusCode).toBe(200);
    expect(layerAsset.headers["content-type"]).toContain("image/png");
    expect(layerAsset.headers["cache-control"]).toContain("immutable");
    expect(layerAsset.headers.etag).toBe(`"${assetSha256}"`);
    expect(layerAsset.rawPayload.subarray(1, 4).toString("ascii")).toBe(
      "PNG",
    );
    const notModified = await app.inject({
      method: "GET",
      url: assetUrl,
      headers: { cookie, "if-none-match": `"${assetSha256}"` },
    });
    expect(notModified.statusCode).toBe(304);
    const legacyAsset = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/layers/${document.json().data.layers[0].id}/asset?sourceVersionId=${sourceVersionId}`,
      headers: { cookie },
    });
    expect(legacyAsset.headers["cache-control"]).toBe("private, no-cache");
    const mismatchedAsset = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/layers/${document.json().data.layers[0].id}/asset?sourceVersionId=${sourceVersionId}&assetSha256=${"0".repeat(64)}`,
      headers: { cookie },
    });
    expect(mismatchedAsset.statusCode).toBe(409);
    expect(mismatchedAsset.json().error.code).toBe(
      "LAYER_ASSET_VERSION_MISMATCH",
    );
    const otherCookie = await registerCreator(app, "other-layer@example.com");
    const crossAccountAsset = await app.inject({
      method: "GET",
      url: assetUrl,
      headers: { cookie: otherCookie },
    });
    expect(crossAccountAsset.statusCode).toBe(404);
  });
  it("rejects processing when a stored source no longer matches its upload hash", async () => {
    const objectStorage = new InMemoryObjectStorage();
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }), { objectStorage });
    const cookie = await registerCreator(app, "source-integrity@example.com");
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "سلامة المصدر السحابي", kind: "image" },
    });
    const projectId = projectResponse.json().data.id as string;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const intent = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: { cookie },
      payload: {
        projectId,
        filename: "integrity.png",
        contentType: "image/png",
        sizeBytes: png.byteLength,
      },
    });
    const uploaded = await app.inject({
      method: "PUT",
      url: intent.json().data.uploadUrl,
      headers: { cookie, "content-type": "image/png" },
      payload: png,
    });
    const tampered = Buffer.from(png);
    tampered[tampered.byteLength - 1] = (tampered.at(-1) ?? 0) ^ 1;
    await objectStorage.put({
      key: intent.json().data.objectKey,
      contentType: "image/png",
      sizeBytes: tampered.byteLength,
      body: tampered,
    });

    const processed = await app.inject({
      method: "POST",
      url: "/v1/processing/jobs",
      headers: {
        cookie,
        "x-idempotency-key": "tampered-source-processing",
      },
      payload: {
        projectId,
        sourceVersionId: uploaded.json().data.sourceVersionId,
      },
    });

    expect(processed.statusCode).toBe(500);
    expect(processed.json().error.code).toBe("SOURCE_INTEGRITY_FAILED");
  });
  it("persists multiple alpha components and exports each as a PSD layer", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app);
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "مكوّنات شفافة", kind: "image" },
    });
    const projectId = projectResponse.json().data.id as string;
    const width = 12;
    const height = 8;
    const pixels = Buffer.alloc(width * height * 4);
    for (const [left, top, red] of [
      [1, 1, 255],
      [6, 1, 160],
      [4, 6, 80],
    ] as const) {
      for (let y = top; y < top + 2; y += 1) {
        for (let x = left; x < left + 2; x += 1) {
          const offset = (y * width + x) * 4;
          pixels[offset] = red;
          pixels[offset + 1] = 40;
          pixels[offset + 2] = 90;
          pixels[offset + 3] = 255;
        }
      }
    }
    const png = await sharp(pixels, {
      raw: { width, height, channels: 4 },
    })
      .png()
      .toBuffer();
    const intent = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: { cookie },
      payload: {
        projectId,
        filename: "components.png",
        contentType: "image/png",
        sizeBytes: png.byteLength,
      },
    });
    const uploaded = await app.inject({
      method: "PUT",
      url: intent.json().data.uploadUrl,
      headers: { cookie, "content-type": "image/png" },
      payload: png,
    });
    const sourceVersionId = uploaded.json().data.sourceVersionId as string;
    const processed = await app.inject({
      method: "POST",
      url: "/v1/processing/jobs",
      headers: {
        cookie,
        "x-idempotency-key": "process-components-001",
      },
      payload: { projectId, sourceVersionId },
    });
    const documentResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/layer-document?sourceVersionId=${sourceVersionId}`,
      headers: { cookie },
    });
    const document = documentResponse.json().data;

    expect(processed.json().data.status).toBe("ready");
    expect(document.imagePreparation).toMatchObject({
      strategy: "alpha-components",
      detectedComponents: 3,
      outputLayers: 3,
      overflowMerged: false,
    });
    expect(document.layers).toHaveLength(3);
    expect(
      document.layers.every(
        (layer: { rasterAsset?: unknown }) => Boolean(layer.rasterAsset),
      ),
    ).toBe(true);
    await approveCurrentReview(app, cookie, projectId, sourceVersionId);

    const exported = await app.inject({
      method: "POST",
      url: "/v1/exports",
      headers: {
        cookie,
        "x-idempotency-key": "psd-components-001",
      },
      payload: {
        projectId,
        sourceVersionId,
        format: "psd",
        scope: "full-document",
        scale: 1,
        colorProfile: "sRGB",
        namingPresetId: "character-basic",
      },
    });
    const download = await app.inject({
      method: "GET",
      url: `/v1/exports/${exported.json().data.id}/download`,
      headers: { cookie },
    });
    const psd = readPsd(download.rawPayload, {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    });
    expect(download.statusCode).toBe(200);
    expect(psd.children).toHaveLength(3);
    expect(psd.children?.map((layer) => layer.name).sort()).toEqual([
      "+جزء_01",
      "+جزء_02",
      "+جزء_03",
    ]);

    const target = document.layers[0] as {
      id: string;
      bounds: { x: number; y: number; width: number; height: number };
    };
    const centerX =
      (target.bounds.x + target.bounds.width / 2) / width;
    const centerY =
      (target.bounds.y + target.bounds.height / 2) / height;
    const refinement = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/guided-refinements`,
      headers: { cookie },
      payload: {
        sourceVersionId,
        baseRevision: document.revision,
        mode: "guided",
        imageStrokes: [
          {
            id: "stroke-separate-component",
            targetLayerId: target.id,
            kind: "separate",
            brushSize: 3,
            points: [
              { x: centerX, y: Math.max(0, centerY - 0.03) },
              { x: centerX, y: Math.min(1, centerY + 0.03) },
            ],
            createdAt: "2026-07-28T00:00:00.000Z",
          },
        ],
        pdfRegions: [],
      },
    });
    expect(refinement.statusCode).toBe(200);
    expect(refinement.json().data.document.revision).toBe(2);
    expect(refinement.json().data.document.layers).toHaveLength(4);
    expect(refinement.json().data.createdLayerIds).toHaveLength(1);
    expect(refinement.json().data.document.guidance).toMatchObject({
      revision: 1,
      mode: "guided",
    });

    const duplicate = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/guided-refinements`,
      headers: { cookie },
      payload: {
        sourceVersionId,
        baseRevision: 2,
        mode: "guided",
        imageStrokes: [
          {
            id: "stroke-separate-component",
            targetLayerId: target.id,
            kind: "separate",
            brushSize: 3,
            points: [
              { x: centerX, y: centerY },
              { x: centerX, y: Math.min(1, centerY + 0.03) },
            ],
            createdAt: "2026-07-28T00:00:01.000Z",
          },
        ],
        pdfRegions: [],
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("GUIDANCE_DUPLICATE");
  });
  it("extracts a text PDF into positioned word layers", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app);
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "كتاب نصي", kind: "book" },
    });
    const projectId = projectResponse.json().data.id as string;
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([400, 300]);
    page.drawText("First motion line", {
      x: 40,
      y: 240,
      size: 18,
      font,
    });
    const source = Buffer.from(await pdf.save());
    const intent = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: { cookie },
      payload: {
        projectId,
        filename: "book.pdf",
        contentType: "application/pdf",
        sizeBytes: source.byteLength,
      },
    });
    const uploaded = await app.inject({
      method: "PUT",
      url: intent.json().data.uploadUrl,
      headers: { cookie, "content-type": "application/pdf" },
      payload: source,
    });
    const sourceVersionId = uploaded.json().data.sourceVersionId as string;

    const processed = await app.inject({
      method: "POST",
      url: "/v1/processing/jobs",
      headers: { cookie },
      payload: {
        projectId,
        sourceVersionId,
        pdfSeparationMode: "word",
      },
    });
    const document = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/layer-document?sourceVersionId=${sourceVersionId}`,
      headers: { cookie },
    });

    expect(processed.statusCode).toBe(202);
    expect(processed.json().data).toMatchObject({
      status: "ready",
      options: { pdfSeparationMode: "word" },
    });
    expect(document.json().data.pages).toEqual([
      { pageNumber: 1, width: 400, height: 300 },
    ]);
    expect(document.json().data.layers[0]).toMatchObject({
      name: "+page_001_background",
      fillColor: "#ffffff",
      locked: true,
      fixed: true,
    });
    expect(
      document
        .json()
        .data.layers.filter(
          (layer: { kind: string }) => layer.kind === "text",
        )
        .map((layer: { fullText: string }) => layer.fullText),
    ).toEqual(["First", "motion", "line"]);

    const firstTextLayer = document
      .json()
      .data.layers.find(
        (layer: { kind: string }) => layer.kind === "text",
      ) as {
      bounds: { x: number; y: number; width: number; height: number };
    };
    const pdfGuidance = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/guided-refinements`,
      headers: { cookie },
      payload: {
        sourceVersionId,
        baseRevision: 1,
        mode: "guided",
        imageStrokes: [],
        pdfRegions: [
          {
            id: "region-first-word",
            pageNumber: 1,
            kind: "heading",
            start: {
              x: Math.max(0, firstTextLayer.bounds.x / 400 - 0.01),
              y: Math.max(0, firstTextLayer.bounds.y / 300 - 0.01),
            },
            end: {
              x: Math.min(
                1,
                (firstTextLayer.bounds.x + firstTextLayer.bounds.width) /
                  400 +
                  0.01,
              ),
              y: Math.min(
                1,
                (firstTextLayer.bounds.y + firstTextLayer.bounds.height) /
                  300 +
                  0.01,
              ),
            },
            readingOrder: 0,
            createdAt: "2026-07-28T00:00:00.000Z",
          },
        ],
      },
    });
    expect(pdfGuidance.statusCode).toBe(200);
    expect(pdfGuidance.json().data.document.layers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "guide-region-first-word",
          kind: "group",
          name: "+heading_000",
        }),
        expect.objectContaining({
          name: "+page_001_background",
          locked: true,
          fixed: true,
        }),
      ]),
    );
    await approveCurrentReview(app, cookie, projectId, sourceVersionId);

    const textExport = await app.inject({
      method: "POST",
      url: "/v1/exports",
      headers: {
        cookie,
        "x-idempotency-key": "book-text-export-001",
      },
      payload: {
        projectId,
        sourceVersionId,
        format: "txt",
        scope: "full-document",
        scale: 1,
        colorProfile: "sRGB",
        namingPresetId: "kinetic-words",
      },
    });
    const textDownload = await app.inject({
      method: "GET",
      url: `/v1/exports/${textExport.json().data.id}/download`,
      headers: { cookie },
    });
    expect(textExport.json().data.status).toBe("ready");
    expect(textDownload.headers["content-type"]).toContain("text/plain");
    expect(textDownload.headers["content-disposition"]).toContain(".txt");
    expect(textDownload.rawPayload.toString("utf8")).toContain(
      "First\nmotion\nline",
    );

    const archiveExport = await app.inject({
      method: "POST",
      url: "/v1/exports",
      headers: {
        cookie,
        "x-idempotency-key": "book-archive-export-001",
      },
      payload: {
        projectId,
        sourceVersionId,
        format: "png-layers-json",
        scope: "full-document",
        scale: 1,
        colorProfile: "sRGB",
        namingPresetId: "kinetic-words",
      },
    });
    const archiveDownload = await app.inject({
      method: "GET",
      url: `/v1/exports/${archiveExport.json().data.id}/download`,
      headers: { cookie },
    });
    const archive = unzipSync(new Uint8Array(archiveDownload.rawPayload));
    const manifest = JSON.parse(strFromU8(archive["manifest.json"]!));
    expect(Buffer.from(archive["source/original.pdf"]!).subarray(0, 5).toString()).toBe(
      "%PDF-",
    );
    expect(
      Buffer.from(archive["pages/page_001_background.png"]!).subarray(1, 4).toString(),
    ).toBe("PNG");
    expect(manifest.layers[0]).toMatchObject({
      name: "+page_001_background",
      file: "pages/page_001_background.png",
      fillColor: "#ffffff",
    });

    const psdExport = await app.inject({
      method: "POST",
      url: "/v1/exports",
      headers: {
        cookie,
        "x-idempotency-key": "book-psd-pages-001",
      },
      payload: {
        projectId,
        sourceVersionId,
        format: "psd",
        scope: "per-page",
        scale: 1,
        colorProfile: "sRGB",
        namingPresetId: "kinetic-words",
      },
    });
    const psdDownload = await app.inject({
      method: "GET",
      url: `/v1/exports/${psdExport.json().data.id}/download`,
      headers: { cookie },
    });
    const psdArchive = unzipSync(new Uint8Array(psdDownload.rawPayload));
    const pagePsd = readPsd(
      Buffer.from(psdArchive["page_001.psd"]!),
      {
        useRawData: true,
        skipThumbnail: true,
      },
    );
    expect(psdExport.statusCode).toBe(202);
    expect(psdExport.json().data.status).toBe("ready");
    expect(psdDownload.headers["content-type"]).toContain("application/zip");
    expect(
      [...(pagePsd.children ?? [])].reverse().map((layer) => layer.name),
    ).toEqual([
      "+line",
      "+motion",
      "+heading_000",
      "+page_001_background",
    ]);
    expect(
      pagePsd.children
        ?.find((layer) => layer.name === "+heading_000")
        ?.children?.map((layer) => layer.name),
    ).toEqual(["+First"]);
    expect(
      pagePsd.children?.find(
        (layer) => layer.name === "+page_001_background",
      )?.protected,
    ).toMatchObject({
      position: true,
      composite: true,
      transparency: true,
    });

    const selectedPageWithoutNumber = await app.inject({
      method: "POST",
      url: "/v1/exports",
      headers: {
        cookie,
        "x-idempotency-key": "book-psd-selected-invalid-001",
      },
      payload: {
        projectId,
        sourceVersionId,
        format: "psd",
        scope: "selected-page",
        scale: 1,
        colorProfile: "sRGB",
        namingPresetId: "kinetic-words",
      },
    });
    expect(selectedPageWithoutNumber.statusCode).toBe(400);
    expect(selectedPageWithoutNumber.json().error.code).toBe(
      "VALIDATION_FAILED",
    );
  });
  it("reanalyzes the same PDF source with a new segmentation mode", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app);
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "إعادة تحليل PDF", kind: "book" },
    });
    const projectId = projectResponse.json().data.id as string;
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([320, 220]);
    page.drawText("Alpha Beta", { x: 40, y: 170, size: 18, font });
    const source = Buffer.from(await pdf.save());
    const intent = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: { cookie },
      payload: {
        projectId,
        filename: "reanalyze.pdf",
        contentType: "application/pdf",
        sizeBytes: source.byteLength,
      },
    });
    const uploaded = await app.inject({
      method: "PUT",
      url: intent.json().data.uploadUrl,
      headers: { cookie, "content-type": "application/pdf" },
      payload: source,
    });
    const sourceVersionId = uploaded.json().data.sourceVersionId as string;
    const processAs = (pdfSeparationMode: "word" | "line", key: string) =>
      app!.inject({
        method: "POST",
        url: "/v1/processing/jobs",
        headers: { cookie, "x-idempotency-key": key },
        payload: { projectId, sourceVersionId, pdfSeparationMode },
      });

    const words = await processAs("word", "pdf-reanalysis-word");
    const conflicting = await processAs("line", "pdf-reanalysis-word");
    const lines = await processAs("line", "pdf-reanalysis-line");
    const document = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/layer-document?sourceVersionId=${sourceVersionId}`,
      headers: { cookie },
    });
    const textLayers = document
      .json()
      .data.layers.filter(
        (layer: { kind: string }) => layer.kind === "text",
      );

    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(words.json().data.id).not.toBe(lines.json().data.id);
    expect(lines.json().data).toMatchObject({
      status: "ready",
      options: { pdfSeparationMode: "line" },
    });
    expect(document.json().data.revision).toBe(2);
    expect(textLayers).toHaveLength(1);
    expect(textLayers[0].fullText).toBe("Alpha Beta");
  });
  it("runs regional OCR idempotently and restores the previous text on undo", async () => {
    const ocrCalls: number[] = [];
    const app = await harness.build(
      loadConfig({ NODE_ENV: "test", PDF_REGION_OCR_ENABLED: "true" }),
      {
        pdfOcrEngine: {
          async recognizePage(input) {
            ocrCalls.push(input.pageNumber);
            expect(input.image.subarray(1, 4).toString("ascii")).toBe("PNG");
            return [
              {
                text: "نص مصحح",
                bounds: {
                  x: 0,
                  y: 0,
                  width: Math.max(1, input.width * 0.8),
                  height: Math.max(1, input.height * 0.8),
                },
                confidence: 0.95,
                direction: "rtl",
              },
            ];
          },
        },
      },
    );
    const cookie = await registerCreator(app, "regional-ocr@example.com");
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "OCR إقليمي", kind: "book" },
    });
    const projectId = projectResponse.json().data.id as string;
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([320, 220]);
    page.drawText("Alpha Beta", { x: 40, y: 170, size: 18, font });
    const source = Buffer.from(await pdf.save());
    const intent = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: { cookie },
      payload: {
        projectId,
        filename: "regional.pdf",
        contentType: "application/pdf",
        sizeBytes: source.byteLength,
      },
    });
    const uploaded = await app.inject({
      method: "PUT",
      url: intent.json().data.uploadUrl,
      headers: { cookie, "content-type": "application/pdf" },
      payload: source,
    });
    const sourceVersionId = uploaded.json().data.sourceVersionId as string;
    await app.inject({
      method: "POST",
      url: "/v1/processing/jobs",
      headers: { cookie, "x-idempotency-key": "regional-initial-001" },
      payload: { projectId, sourceVersionId, pdfSeparationMode: "line" },
    });
    const before = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/layer-document?sourceVersionId=${sourceVersionId}`,
      headers: { cookie },
    });
    const beforeDocument = before.json().data;
    const textLayer = beforeDocument.layers.find(
      (layer: { kind: string }) => layer.kind === "text",
    );
    const bounds = textLayer.bounds as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    const regionalPayload = {
      sourceVersionId,
      baseRevision: beforeDocument.revision,
      pageNumber: 1,
      start: { x: bounds.x / 320, y: bounds.y / 220 },
      end: {
        x: (bounds.x + bounds.width) / 320,
        y: (bounds.y + bounds.height) / 220,
      },
    };
    const regional = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/layer-document/text/region-ocr`,
      headers: { cookie, "x-idempotency-key": "regional-operation-001" },
      payload: regionalPayload,
    });
    const replay = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/layer-document/text/region-ocr`,
      headers: { cookie, "x-idempotency-key": "regional-operation-001" },
      payload: regionalPayload,
    });
    const after = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/layer-document?sourceVersionId=${sourceVersionId}`,
      headers: { cookie },
    });

    expect(regional.statusCode).toBe(202);
    expect(regional.json().data.status).toBe("ready");
    expect(replay.json().data.id).toBe(regional.json().data.id);
    expect(ocrCalls).toEqual([1]);
    expect(after.json().data.revision).toBe(2);
    expect(
      after.json().data.layers.some(
        (layer: { fullText?: string }) => layer.fullText === "نص مصحح",
      ),
    ).toBe(true);
    expect(after.json().data.editTimeline.entries.at(-1).kind).toBe(
      "pdf-region-ocr",
    );

    const undone = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/layer-document/history`,
      headers: { cookie },
      payload: { sourceVersionId, baseRevision: 2, direction: "undo" },
    });
    expect(undone.statusCode).toBe(200);
    expect(
      undone.json().data.layers.some(
        (layer: { fullText?: string }) => layer.fullText === "Alpha Beta",
      ),
    ).toBe(true);
  });
  it("disables regional OCR independently through its runtime kill switch", async () => {
    const app = await harness.build(
      loadConfig({
        NODE_ENV: "test",
        PDF_REGION_OCR_ENABLED: "false",
      }),
    );
    const cookie = await registerCreator(app, "regional-ocr-disabled@example.com");
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "OCR متوقف", kind: "book" },
    });
    const projectId = projectResponse.json().data.id as string;
    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/layer-document/text/region-ocr`,
      headers: { cookie },
      payload: {
        sourceVersionId: "00000000-0000-4000-8000-000000000111",
        baseRevision: 1,
        pageNumber: 1,
        start: { x: 0.1, y: 0.1 },
        end: { x: 0.5, y: 0.5 },
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("FEATURE_DISABLED");
  });
  it("reports OCR_REQUIRED for a PDF page without embedded text", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app);
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "كتاب ممسوح", kind: "book" },
    });
    const projectId = projectResponse.json().data.id as string;
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([400, 300]);
    const pixel = await pdf.embedPng(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    page.drawImage(pixel, { x: 0, y: 0, width: 400, height: 300 });
    const source = Buffer.from(await pdf.save());
    const intent = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: { cookie },
      payload: {
        projectId,
        filename: "scan.pdf",
        contentType: "application/pdf",
        sizeBytes: source.byteLength,
      },
    });
    const uploaded = await app.inject({
      method: "PUT",
      url: intent.json().data.uploadUrl,
      headers: { cookie, "content-type": "application/pdf" },
      payload: source,
    });

    const processed = await app.inject({
      method: "POST",
      url: "/v1/processing/jobs",
      headers: { cookie },
      payload: {
        projectId,
        sourceVersionId: uploaded.json().data.sourceVersionId,
        pdfSeparationMode: "line",
      },
    });

    expect(processed.statusCode).toBe(422);
    expect(processed.json().error.code).toBe("OCR_REQUIRED");
  });
  it("queues image processing without running it inside API in worker mode", async () => {
    const app = await harness.build(
      loadConfig({
        NODE_ENV: "test",
        PROCESSING_EXECUTION_MODE: "worker",
      }),
    );
    const cookie = await registerCreator(app);
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "مهمة عامل منفصلة", kind: "image" },
    });
    const projectId = projectResponse.json().data.id as string;
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    const intent = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: { cookie },
      payload: {
        projectId,
        filename: "queued.png",
        contentType: "image/png",
        sizeBytes: png.byteLength,
      },
    });
    const uploaded = await app.inject({
      method: "PUT",
      url: intent.json().data.uploadUrl,
      headers: { cookie, "content-type": "image/png" },
      payload: png,
    });
    const queued = await app.inject({
      method: "POST",
      url: "/v1/processing/jobs",
      headers: { cookie },
      payload: {
        projectId,
        sourceVersionId: uploaded.json().data.sourceVersionId,
      },
    });
    const document = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/layer-document`,
      headers: { cookie },
    });

    expect(queued.statusCode).toBe(202);
    expect(queued.json().data.status).toBe("queued");
    expect(document.statusCode).toBe(404);
  });
  it("rejects processing of a ready source that is no longer current", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app, "current-source@example.com");
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "معالجة المصدر الحالي", kind: "image" },
    });
    const projectId = projectResponse.json().data.id as string;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const upload = async (filename: string, replaceSourceVersion: boolean) => {
      const intent = await app.inject({
        method: "POST",
        url: "/v1/uploads/intents",
        headers: {
          cookie,
          "x-idempotency-key": `current-source-${filename}`,
        },
        payload: {
          projectId,
          filename,
          contentType: "image/png",
          sizeBytes: png.byteLength,
          replaceSourceVersion,
        },
      });
      const uploaded = await app.inject({
        method: "PUT",
        url: intent.json().data.uploadUrl,
        headers: { cookie, "content-type": "image/png" },
        payload: png,
      });
      return uploaded.json().data.sourceVersionId as string;
    };
    const firstSource = await upload("first.png", false);
    const secondSource = await upload("second.png", true);

    const stale = await app.inject({
      method: "POST",
      url: "/v1/processing/jobs",
      headers: {
        cookie,
        "x-idempotency-key": "stale-current-source",
      },
      payload: { projectId, sourceVersionId: firstSource },
    });
    const projects = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { cookie },
    });

    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("SOURCE_NOT_CURRENT");
    expect(projects.json().data[0]).toMatchObject({
      currentSourceVersionId: secondSource,
      status: "queued",
    });
  });
});
