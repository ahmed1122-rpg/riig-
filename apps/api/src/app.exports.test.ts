import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import {
  createAppTestHarness,
  registerCreator,
} from "./app-test-helpers.js";
import { InMemoryExportRepository } from "./exports/export-repository.js";
import { strFromU8, unzipSync } from "fflate";
import { readPsd } from "ag-psd";
import sharp from "sharp";

const harness = createAppTestHarness();

describe("API — التصدير", () => {
  it("cancels an owned queued export safely", async () => {
    const exports = new InMemoryExportRepository();
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }), { exports });
    const cookie = await registerCreator(app);
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "تصدير شخصية", kind: "image" },
    });
    const exportId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    await exports.save({
      id: exportId,
      projectId: projectResponse.json().data.id,
      sourceVersionId: crypto.randomUUID(),
      projectKind: "image",
      format: "psd",
      scope: "full-document",
      scale: 1,
      colorProfile: "sRGB",
      namingPresetId: "adobe-default",
      status: "queued",
      progress: 0,
      attempt: 0,
      maxAttempts: 3,
      nextAttemptAt: timestamp,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const cancelled = await app.inject({
      method: "POST",
      url: `/v1/exports/${exportId}/cancel`,
      headers: { cookie },
    });

    expect(cancelled.json().data.status).toBe("cancelled");
  });
  it("rejects a text export for an image project", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app);
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "صورة لا تدعم TXT", kind: "image" },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/exports",
      headers: { cookie },
      payload: {
        projectId: projectResponse.json().data.id,
        sourceVersionId: crypto.randomUUID(),
        format: "txt",
        scope: "full-document",
        scale: 1,
        colorProfile: "sRGB",
        namingPresetId: "character-basic",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("EXPORT_FORMAT_UNSUPPORTED");
  });
  it.each(["layered-tiff", "transparent-pngs"] as const)(
    "rejects the image-only %s format for a PDF project",
    async (format) => {
      const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
      const cookie = await registerCreator(app);
      const projectResponse = await app.inject({
        method: "POST",
        url: "/v1/projects",
        headers: { cookie },
        payload: { name: "كتاب بصيغ تصدير مقيدة", kind: "book" },
      });
      const response = await app.inject({
        method: "POST",
        url: "/v1/exports",
        headers: { cookie },
        payload: {
          projectId: projectResponse.json().data.id,
          sourceVersionId: crypto.randomUUID(),
          format,
          scope: "full-document",
          scale: 1,
          colorProfile: "sRGB",
          namingPresetId: "book-default",
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("EXPORT_FORMAT_UNSUPPORTED");
    },
  );
  it("queues exports without generating them inside the API in worker mode", async () => {
    const app = await harness.build(
      loadConfig({
        NODE_ENV: "test",
        EXPORT_EXECUTION_MODE: "worker",
      }),
    );
    const cookie = await registerCreator(app);
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "تصدير خلفي", kind: "image" },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/exports",
      headers: {
        cookie,
        "x-idempotency-key": "worker-export-001",
      },
      payload: {
        projectId: projectResponse.json().data.id,
        sourceVersionId: crypto.randomUUID(),
        format: "psd",
        scope: "full-document",
        scale: 1,
        colorProfile: "sRGB",
        namingPresetId: "adobe-default",
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().data).toMatchObject({
      status: "queued",
      progress: 0,
      attempt: 0,
      maxAttempts: 3,
      leaseOwner: null,
    });
  });
  it("exports a verified source as a downloadable PNG layers and JSON archive", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app);
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "حزمة طبقات", kind: "image" },
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
        filename: "layer.png",
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
    await app.inject({
      method: "POST",
      url: "/v1/processing/jobs",
      headers: {
        cookie,
        "x-idempotency-key": "process-before-export-001",
      },
      payload: {
        projectId,
        sourceVersionId: uploaded.json().data.sourceVersionId,
      },
    });
    const exported = await app.inject({
      method: "POST",
      url: "/v1/exports",
      headers: {
        cookie,
        "x-idempotency-key": "fallback-export-001",
      },
      payload: {
        projectId,
        sourceVersionId: uploaded.json().data.sourceVersionId,
        format: "png-layers-json",
        scope: "full-document",
        scale: 1,
        colorProfile: "sRGB",
        namingPresetId: "character-basic",
      },
    });
    const repeated = await app.inject({
      method: "POST",
      url: "/v1/exports",
      headers: {
        cookie,
        "x-idempotency-key": "fallback-export-001",
      },
      payload: {
        projectId,
        sourceVersionId: uploaded.json().data.sourceVersionId,
        format: "png-layers-json",
        scope: "full-document",
        scale: 1,
        colorProfile: "sRGB",
        namingPresetId: "character-basic",
      },
    });

    expect(exported.statusCode).toBe(202);
    expect(repeated.json().data.id).toBe(exported.json().data.id);
    expect(exported.json().data.status).toBe("ready");
    expect(exported.json().data.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);

    const download = await app.inject({
      method: "GET",
      url: `/v1/exports/${exported.json().data.id}/download`,
      headers: { cookie },
    });
    const archive = unzipSync(new Uint8Array(download.rawPayload));
    const manifest = JSON.parse(strFromU8(archive["manifest.json"]!));

    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("application/zip");
    expect(manifest.layers[0].name).toBe("+source");
    expect(
      Buffer.from(archive[manifest.layers[0].file as string]!)
        .subarray(1, 4)
        .toString("ascii"),
    ).toBe("PNG");

    const projects = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { cookie },
    });
    expect(projects.json().data[0].status).toBe("completed");
  });
  it("exports a verified image as PSD and full-canvas transparent PNGs", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app);
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "حزمة Adobe", kind: "image" },
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
        filename: "source.png",
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
    await app.inject({
      method: "POST",
      url: "/v1/processing/jobs",
      headers: {
        cookie,
        "x-idempotency-key": "process-adobe-export-001",
      },
      payload: { projectId, sourceVersionId },
    });
    const documentResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/layer-document?sourceVersionId=${sourceVersionId}`,
      headers: { cookie },
    });
    const sourceLayerId = documentResponse.json().data.layers[0].id as string;
    const reviewUpdate = {
      sourceVersionId,
      baseRevision: 1,
      layers: [
        {
          id: sourceLayerId,
          name: "+reviewed_source",
          visible: true,
          locked: true,
          opacity: 0.4,
          zIndex: 1,
        },
      ],
    };
    const updatedDocument = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/layer-document`,
      headers: { cookie },
      payload: reviewUpdate,
    });
    const staleUpdate = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/layer-document`,
      headers: { cookie },
      payload: reviewUpdate,
    });

    expect(updatedDocument.statusCode).toBe(200);
    expect(updatedDocument.json().data.revision).toBe(2);
    expect(staleUpdate.statusCode).toBe(409);
    expect(staleUpdate.json().error.code).toBe(
      "DOCUMENT_REVISION_CONFLICT",
    );

    const psdExport = await app.inject({
      method: "POST",
      url: "/v1/exports",
      headers: {
        cookie,
        "x-idempotency-key": "psd-export-001",
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
    const psdDownload = await app.inject({
      method: "GET",
      url: `/v1/exports/${psdExport.json().data.id}/download`,
      headers: { cookie },
    });

    expect(psdExport.statusCode).toBe(202);
    expect(psdExport.json().data.status).toBe("ready");
    expect(psdDownload.statusCode).toBe(200);
    expect(psdDownload.headers["content-type"]).toContain(
      "image/vnd.adobe.photoshop",
    );
    expect(psdDownload.headers["content-disposition"]).toContain(".psd");
    expect(psdDownload.rawPayload.subarray(0, 4).toString("ascii")).toBe(
      "8BPS",
    );
    const decodedPsd = readPsd(psdDownload.rawPayload, {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    });
    expect(decodedPsd.children?.[0]).toMatchObject({
      name: "+reviewed_source",
      hidden: false,
      protected: {
        position: true,
        composite: true,
        transparency: true,
      },
    });
    expect(decodedPsd.children?.[0]?.opacity).toBeCloseTo(0.4, 2);

    const pngExport = await app.inject({
      method: "POST",
      url: "/v1/exports",
      headers: {
        cookie,
        "x-idempotency-key": "transparent-png-export-001",
      },
      payload: {
        projectId,
        sourceVersionId,
        format: "transparent-pngs",
        scope: "full-document",
        scale: 1,
        colorProfile: "sRGB",
        namingPresetId: "character-basic",
      },
    });
    const pngDownload = await app.inject({
      method: "GET",
      url: `/v1/exports/${pngExport.json().data.id}/download`,
      headers: { cookie },
    });
    const archive = unzipSync(new Uint8Array(pngDownload.rawPayload));
    const manifest = JSON.parse(strFromU8(archive["manifest.json"]!));
    const layerFile = manifest.layers[0].file as string;

    expect(pngExport.statusCode).toBe(202);
    expect(pngExport.json().data.status).toBe("ready");
    expect(pngDownload.headers["content-disposition"]).toContain(
      "transparent-pngs.zip",
    );
    expect(Buffer.from(archive[layerFile]!).subarray(1, 4).toString("ascii")).toBe(
      "PNG",
    );
    expect(manifest.layers[0]).toMatchObject({
      name: "+reviewed_source",
      file: layerFile,
    });

    const tiffExport = await app.inject({
      method: "POST",
      url: "/v1/exports",
      headers: {
        cookie,
        "x-idempotency-key": "layered-tiff-export-001",
      },
      payload: {
        projectId,
        sourceVersionId,
        format: "layered-tiff",
        scope: "full-document",
        scale: 1,
        colorProfile: "sRGB",
        namingPresetId: "character-basic",
      },
    });
    const tiffDownload = await app.inject({
      method: "GET",
      url: `/v1/exports/${tiffExport.json().data.id}/download`,
      headers: { cookie },
    });
    const tiffMetadata = await sharp(tiffDownload.rawPayload, {
      pages: -1,
    }).metadata();

    expect(tiffExport.statusCode).toBe(202);
    expect(tiffDownload.headers["content-type"]).toContain("image/tiff");
    expect(tiffDownload.headers["content-disposition"]).toContain(".tiff");
    expect(tiffMetadata).toMatchObject({
      format: "tiff",
      pages: 1,
    });
  });
});
