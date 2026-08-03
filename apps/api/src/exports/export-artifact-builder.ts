import { strToU8 } from "fflate";
import type {
  ExportJob,
  LayerDocument,
  ProjectKind,
  UploadSession,
} from "@motionprep/contracts";
import {
  createLayeredTiff,
  createPdfDocumentPsd,
  createPdfPagePsd,
  createRasterPsd,
  createTransparentPngs,
  ExportAdapterError,
  type RasterLayerAsset,
} from "@motionprep/export-adapters";
import type { UploadRepository } from "../uploads/upload-repository.js";
import type {
  ObjectStorage,
  StoredObject,
} from "../storage/object-storage.js";
import { isObjectStorageIntegrityFailure } from "../storage/object-storage.js";
import { hasExpectedObjectIntegrity } from "../storage/object-integrity.js";
import { renderSolidPng } from "./export-raster-renderer.js";
import {
  createManifest,
  createTextArtifact,
  sourceExtension,
  type GeneratedArtifact,
} from "./export-artifact-helpers.js";
import { createZipArchive } from "./export-archive.js";
import { ExportDomainError } from "./export-errors.js";

interface ReadySource {
  upload: UploadSession;
  object: StoredObject;
}

export class ExportArtifactBuilder {
  constructor(
    private readonly uploads?: UploadRepository,
    private readonly storage?: ObjectStorage,
  ) {}

  async create(
    job: ExportJob,
    projectKind: ProjectKind,
    document: LayerDocument,
    namingPresetId: string,
  ): Promise<GeneratedArtifact> {
    switch (job.format) {
      case "png-layers-json":
        return this.createLayerArchive(
          job,
          projectKind,
          document,
          namingPresetId,
        );
      case "psd":
        return projectKind === "book"
          ? this.createPdfPsdArtifact(job, document)
          : this.createPsdArtifact(job, document);
      case "transparent-pngs":
        return this.createTransparentPngArchive(
          job,
          document,
          namingPresetId,
        );
      case "layered-tiff":
        return this.createTiffArtifact(job, document);
      case "txt":
      case "csv":
      case "json":
        return createTextArtifact(job, document);
      default:
        throw new ExportDomainError(
          "EXPORT_FORMAT_UNSUPPORTED",
          "محول صيغة التصدير المطلوبة غير متاح.",
        );
    }
  }

  private async createPsdArtifact(
    job: ExportJob,
    document: LayerDocument,
  ): Promise<GeneratedArtifact> {
    return {
      body: await createRasterPsd(
        document,
        await this.loadRasterAssets(job, document),
      ),
      filename: `motionprep-${job.projectId}.psd`,
      contentType: "image/vnd.adobe.photoshop",
    };
  }

  private async createTiffArtifact(
    job: ExportJob,
    document: LayerDocument,
  ): Promise<GeneratedArtifact> {
    return {
      body: await createLayeredTiff(
        document,
        await this.loadRasterAssets(job, document),
      ),
      filename: `motionprep-${job.projectId}-layers.tiff`,
      contentType: "image/tiff",
    };
  }

  private async createPdfPsdArtifact(
    job: ExportJob,
    document: LayerDocument,
  ): Promise<GeneratedArtifact> {
    const pages = document.pages ?? [];
    if (pages.length === 0) {
      throw new ExportDomainError(
        "EXPORT_PREFLIGHT_FAILED",
        "وثيقة PDF لا تحتوي صفحات صالحة للتصدير.",
      );
    }
    if (job.scope === "selected-page") {
      const pageNumber = job.selectedPage;
      if (
        pageNumber === undefined ||
        !pages.some((page) => page.pageNumber === pageNumber)
      ) {
        throw new ExportDomainError(
          "EXPORT_SCOPE_UNSUPPORTED",
          "الصفحة المحددة غير موجودة في وثيقة PDF.",
        );
      }
      return {
        body: await createPdfPagePsd(document, pageNumber),
        filename:
          `motionprep-${job.projectId}-page_` +
          `${String(pageNumber).padStart(3, "0")}.psd`,
        contentType: "image/vnd.adobe.photoshop",
      };
    }
    if (job.scope === "full-document") {
      return {
        body: await createPdfDocumentPsd(document),
        filename: `motionprep-${job.projectId}.psd`,
        contentType: "image/vnd.adobe.photoshop",
      };
    }

    const entries: Record<string, Uint8Array> = {};
    for (const page of pages) {
      const filename = `page_${String(page.pageNumber).padStart(3, "0")}.psd`;
      entries[filename] = new Uint8Array(
        await createPdfPagePsd(document, page.pageNumber),
      );
    }
    entries["manifest.json"] = strToU8(
      JSON.stringify(
        {
          schemaVersion: "1.0",
          projectId: job.projectId,
          sourceVersionId: job.sourceVersionId,
          documentRevision: document.revision ?? 1,
          pages: pages.map((page) => ({
            pageNumber: page.pageNumber,
            file: `page_${String(page.pageNumber).padStart(3, "0")}.psd`,
          })),
        },
        null,
        2,
      ),
    );
    return {
      body: await createZipArchive(entries),
      filename: `motionprep-${job.projectId}-pages-psd.zip`,
      contentType: "application/zip",
    };
  }

  private async createTransparentPngArchive(
    job: ExportJob,
    document: LayerDocument,
    namingPresetId: string,
  ): Promise<GeneratedArtifact> {
    const { upload, object } = await this.loadReadySource(job);
    const pngs = await createTransparentPngs(
      document,
      await this.loadRasterAssets(job, document),
    );
    const extension = sourceExtension(upload.contentType);
    const sourceFilename = `source/original.${extension}`;
    const entries: Record<string, Uint8Array> = {
      [sourceFilename]: new Uint8Array(object.body),
    };
    const layerFiles = new Map<string, string>();
    for (const png of pngs) {
      const filename = `layers/${png.filename}`;
      entries[filename] = new Uint8Array(png.body);
      layerFiles.set(png.layerId, filename);
    }
    addManifest(
      entries,
      job,
      document,
      namingPresetId,
      sourceFilename,
      upload.sha256,
      layerFiles,
    );
    return {
      body: await createZipArchive(entries),
      filename: `motionprep-${job.projectId}-transparent-pngs.zip`,
      contentType: "application/zip",
    };
  }

  private async createLayerArchive(
    job: ExportJob,
    projectKind: ProjectKind,
    document: LayerDocument,
    namingPresetId: string,
  ): Promise<GeneratedArtifact> {
    const { upload, object: source } = await this.loadReadySource(job);
    const entries: Record<string, Uint8Array> = {};
    const layerFiles = new Map<string, string>();
    const extension = sourceExtension(upload.contentType);
    const sourceFilename = `source/original.${extension}`;
    entries[sourceFilename] = new Uint8Array(source.body);

    if (projectKind === "image") {
      const pngs = await createTransparentPngs(
        document,
        await this.loadRasterAssets(job, document),
      );
      for (const png of pngs) {
        const filename = `layers/${png.filename}`;
        entries[filename] = new Uint8Array(png.body);
        layerFiles.set(png.layerId, filename);
      }
    } else {
      for (const page of document.pages ?? []) {
        assertRenderablePage(page.width, page.height);
        const background = document.layers.find(
          (layer) =>
            layer.pageNumber === page.pageNumber &&
            layer.fillColor === "#ffffff",
        );
        if (!background) continue;
        const filename = `pages/page_${page.pageNumber
          .toString()
          .padStart(3, "0")}_background.png`;
        entries[filename] = new Uint8Array(
          await renderSolidPng({
            width: Math.ceil(page.width),
            height: Math.ceil(page.height),
            background: "#ffffff",
          }),
        );
        layerFiles.set(background.id, filename);
      }
    }

    addManifest(
      entries,
      job,
      document,
      namingPresetId,
      sourceFilename,
      upload.sha256,
      layerFiles,
    );
    return {
      body: await createZipArchive(entries),
      filename: `motionprep-${job.projectId}.zip`,
      contentType: "application/zip",
    };
  }

  private async loadReadySource(job: ExportJob): Promise<ReadySource> {
    if (!this.uploads || !this.storage) {
      throw new Error("Upload repository and object storage are required.");
    }
    const upload = await this.uploads.findReadyBySourceVersion(
      job.projectId,
      job.sourceVersionId,
    );
    if (!upload) {
      throw new ExportDomainError(
        "EXPORT_SOURCE_NOT_READY",
        "نسخة المصدر المطلوبة غير موجودة أو لم يكتمل رفعها.",
      );
    }
    let object: StoredObject | null;
    try {
      object = await this.storage.get(upload.objectKey, {
        maxBytes: upload.expectedSizeBytes,
      });
    } catch (error) {
      if (isObjectStorageIntegrityFailure(error)) {
        throw new ExportDomainError(
          "EXPORT_SOURCE_INTEGRITY_FAILED",
          "فشل التحقق من سلامة ملف المصدر المخزن.",
        );
      }
      throw error;
    }
    if (!object) {
      throw new ExportDomainError(
        "EXPORT_SOURCE_NOT_READY",
        "ملف المصدر غير متاح في التخزين.",
      );
    }
    if (
      !upload.sha256 ||
      !hasExpectedObjectIntegrity(object, {
        contentType: upload.contentType,
        sizeBytes: upload.expectedSizeBytes,
        sha256: upload.sha256,
      })
    ) {
      throw new ExportDomainError(
        "EXPORT_SOURCE_INTEGRITY_FAILED",
        "فشل التحقق من سلامة ملف المصدر المخزن.",
      );
    }
    return { upload, object };
  }

  private async loadRasterAssets(
    job: ExportJob,
    document: LayerDocument,
  ): Promise<RasterLayerAsset[]> {
    const storage = this.storage;
    if (!storage) throw new Error("Object storage is required.");
    const layers = document.layers.filter(
      (layer) => layer.kind === "raster",
    );
    if (layers.length === 0) {
      throw new ExportAdapterError(
        "RASTER_LAYER_REQUIRED",
        "لا توجد طبقة Raster قابلة للتصدير.",
      );
    }

    const referenced = layers.filter((layer) => layer.rasterAsset);
    if (referenced.length === layers.length) {
      return Promise.all(
        layers.map(async (layer) => {
          const reference = layer.rasterAsset!;
          let object: StoredObject | null;
          try {
            object = await storage.get(reference.objectKey, {
              maxBytes: reference.sizeBytes,
            });
          } catch (error) {
            if (isObjectStorageIntegrityFailure(error)) {
              throw new ExportAdapterError(
                "RASTER_ASSET_MISMATCH",
                `فشل التحقق من سلامة أصل الطبقة ${layer.name}.`,
              );
            }
            throw error;
          }
          if (!object) {
            throw new ExportAdapterError(
              "RASTER_ASSET_MISMATCH",
              `أصل الطبقة ${layer.name} غير متاح في التخزين.`,
            );
          }
          if (!hasExpectedObjectIntegrity(object, reference)) {
            throw new ExportAdapterError(
              "RASTER_ASSET_MISMATCH",
              `فشل التحقق من سلامة أصل الطبقة ${layer.name}.`,
            );
          }
          return { layer, source: object.body };
        }),
      );
    }

    if (referenced.length === 0 && layers.length === 1) {
      const { object } = await this.loadReadySource(job);
      return [{ layer: layers[0]!, source: object.body }];
    }
    throw new ExportAdapterError(
      "RASTER_ASSET_MISMATCH",
      "وثيقة الطبقات تحمل مراجع أصول Raster ناقصة.",
    );
  }
}

function assertRenderablePage(width: number, height: number): void {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > 100_000_000
  ) {
    throw new ExportDomainError(
      "EXPORT_PREFLIGHT_FAILED",
      "أبعاد إحدى صفحات PDF تتجاوز حد المعالجة الآمن.",
    );
  }
}

function addManifest(
  entries: Record<string, Uint8Array>,
  job: ExportJob,
  document: LayerDocument,
  namingPresetId: string,
  sourceFilename: string,
  sourceSha256: string | null,
  layerFiles: ReadonlyMap<string, string>,
): void {
  entries["manifest.json"] = strToU8(
    JSON.stringify(
      createManifest(
        job,
        document,
        namingPresetId,
        sourceFilename,
        sourceSha256,
        layerFiles,
      ),
      null,
      2,
    ),
  );
}
