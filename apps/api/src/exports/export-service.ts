import { createHash } from "node:crypto";
import type {
  ExportFormat,
  ExportJob,
  ExportRequest,
  LayerDocument,
  ProjectKind,
  UploadSession,
} from "@motionprep/contracts";
import {
  createPdfDocumentPsd,
  createPdfPagePsd,
  createLayeredTiff,
  createRasterPsd,
  createTransparentPngs,
  ExportAdapterError,
  type RasterLayerAsset,
} from "@motionprep/export-adapters";
import { validateProductionDocument } from "@motionprep/presets";
import { strToU8, zipSync } from "fflate";
import sharp from "sharp";
import {
  InMemoryIdempotencyStore,
  type IdempotencyStore,
} from "../idempotency/idempotency-store.js";
import type { LayerDocumentRepository } from "../processing/processing-repository.js";
import type {
  ObjectStorage,
  StoredObject,
} from "../storage/object-storage.js";
import { hasExpectedObjectIntegrity } from "../storage/object-integrity.js";
import type { UploadRepository } from "../uploads/upload-repository.js";
import type { ExportRepository } from "./export-repository.js";
import {
  createManifest,
  createTextArtifact,
  sourceExtension,
  type GeneratedArtifact,
} from "./export-artifact-helpers.js";

export class ExportDomainError extends Error {
  constructor(
    readonly code:
      | "EXPORT_NOT_FOUND"
      | "EXPORT_FORMAT_UNSUPPORTED"
      | "EXPORT_SCOPE_UNSUPPORTED"
      | "EXPORT_NOT_CANCELLABLE"
      | "EXPORT_SOURCE_NOT_READY"
      | "EXPORT_SOURCE_INTEGRITY_FAILED"
      | "EXPORT_ARTIFACT_NOT_READY"
      | "EXPORT_ARTIFACT_INTEGRITY_FAILED"
      | "EXPORT_DOCUMENT_NOT_READY"
      | "EXPORT_DOCUMENT_REVISION_CONFLICT"
      | "EXPORT_PREFLIGHT_FAILED"
      | "EXPORT_REQUEST_IN_PROGRESS",
    message: string,
  ) {
    super(message);
  }
}

const imageFormats = new Set<ExportFormat>([
  "psd",
  "png-layers-json",
  "layered-tiff",
  "transparent-pngs",
]);
const bookFormats = new Set<ExportFormat>([
  "psd",
  "png-layers-json",
  "txt",
  "csv",
  "json",
]);

interface ReadySource {
  upload: UploadSession;
  object: StoredObject;
}

export class ExportService {
  constructor(
    private readonly repository: ExportRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly idempotency: IdempotencyStore =
      new InMemoryIdempotencyStore(),
    private readonly uploads?: UploadRepository,
    private readonly storage?: ObjectStorage,
    private readonly layerDocuments?: LayerDocumentRepository,
    private readonly executeInline = true,
  ) {}

  async create(
    input: ExportRequest,
    projectKind: ProjectKind,
    idempotencyKey: string,
  ): Promise<ExportJob> {
    const supported =
      projectKind === "image" ? imageFormats : bookFormats;
    if (!supported.has(input.format)) {
      throw new ExportDomainError(
        "EXPORT_FORMAT_UNSUPPORTED",
        "محول صيغة التصدير المطلوبة غير متاح بعد لهذا النوع من المشاريع.",
      );
    }
    if (
      projectKind === "image" &&
      (input.scope === "per-page" || input.scope === "selected-page")
    ) {
      throw new ExportDomainError(
        "EXPORT_SCOPE_UNSUPPORTED",
        "نطاق الصفحة متاح لمشاريع PDF فقط.",
      );
    }

    const scopedIdempotencyKey = `${input.projectId}:${idempotencyKey}`;
    const exportId = crypto.randomUUID();
    const claimedId = await this.idempotency.claim(
      "export",
      scopedIdempotencyKey,
      exportId,
      24 * 60 * 60,
    );
    if (claimedId !== exportId) {
      const existing = await this.repository.findById(claimedId);
      if (existing) return existing;
      throw new ExportDomainError(
        "EXPORT_REQUEST_IN_PROGRESS",
        "طلب التصدير المطابق ما زال قيد الإنشاء. أعد المحاولة بعد لحظات.",
      );
    }

    const timestamp = this.now().toISOString();
    const requestedDocument = this.layerDocuments
      ? await this.layerDocuments.findBySource(
          input.projectId,
          input.sourceVersionId,
        )
      : null;
    if (
      input.documentRevision !== undefined &&
      (!requestedDocument ||
        (requestedDocument.revision ?? 1) !== input.documentRevision)
    ) {
      await this.idempotency.release(
        "export",
        scopedIdempotencyKey,
        exportId,
      );
      throw new ExportDomainError(
        "EXPORT_DOCUMENT_REVISION_CONFLICT",
        "تغيرت وثيقة الطبقات قبل بدء التصدير. احفظ أحدث مراجعة ثم أعد المحاولة.",
      );
    }
    const documentRevision =
      input.documentRevision ?? requestedDocument?.revision ?? 1;
    const job: ExportJob = {
      id: exportId,
      projectId: input.projectId,
      sourceVersionId: input.sourceVersionId,
      documentRevision,
      projectKind,
      format: input.format,
      scope: input.scope,
      ...(input.selectedPage === undefined
        ? {}
        : { selectedPage: input.selectedPage }),
      scale: input.scale,
      colorProfile: input.colorProfile,
      namingPresetId: input.namingPresetId,
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
    };
    try {
      await this.repository.save(job);
      if (!this.executeInline) return job;
      return await this.generateArtifact(
        job,
        projectKind,
        input.namingPresetId,
      );
    } catch (error) {
      const current = await this.repository.findById(exportId);
      if (current && !["ready", "cancelled"].includes(current.status)) {
        await this.fail(current, exportErrorCode(error));
      }
      await this.idempotency.release(
        "export",
        scopedIdempotencyKey,
        exportId,
      );
      throw error;
    }
  }

  async artifact(id: string): Promise<StoredObject> {
    const job = await this.find(id);
    if (job.status !== "ready" || !job.artifact || !this.storage) {
      throw new ExportDomainError(
        "EXPORT_ARTIFACT_NOT_READY",
        "ملف التصدير غير جاهز للتنزيل.",
      );
    }
    if (Date.parse(job.artifact.expiresAt) <= this.now().getTime()) {
      await this.storage.delete(this.artifactKey(job)).catch(() => undefined);
      throw new ExportDomainError(
        "EXPORT_ARTIFACT_NOT_READY",
        "انتهت مدة الاحتفاظ بملف التصدير.",
      );
    }
    const object = await this.storage.get(this.artifactKey(job));
    if (!object) {
      throw new ExportDomainError(
        "EXPORT_ARTIFACT_NOT_READY",
        "ملف التصدير غير متاح أو انتهت مدة الاحتفاظ به.",
      );
    }
    if (
      !hasExpectedObjectIntegrity(object, {
        sizeBytes: job.artifact.sizeBytes,
        sha256: job.artifact.sha256,
      })
    ) {
      throw new ExportDomainError(
        "EXPORT_ARTIFACT_INTEGRITY_FAILED",
        "فشل التحقق من سلامة ملف التصدير المخزن.",
      );
    }
    return object;
  }

  async find(id: string): Promise<ExportJob> {
    const job = await this.repository.findById(id);
    if (!job) {
      throw new ExportDomainError(
        "EXPORT_NOT_FOUND",
        "مهمة التصدير غير موجودة.",
      );
    }
    return job;
  }

  async listByProjectIds(projectIds: string[]): Promise<ExportJob[]> {
    return this.repository.listByProjectIds(projectIds);
  }

  async cancel(id: string): Promise<ExportJob> {
    const job = await this.find(id);
    if (job.status === "cancelled") return job;
    if (
      job.status === "ready" ||
      job.status === "verifying" ||
      job.status === "failed"
    ) {
      throw new ExportDomainError(
        "EXPORT_NOT_CANCELLABLE",
        "لا يمكن إلغاء مهمة التصدير في حالتها الحالية.",
      );
    }
    const cancelled = await this.repository.requestCancel(
      id,
      this.now().toISOString(),
    );
    if (!cancelled || cancelled.status !== "cancelled") {
      throw new ExportDomainError(
        "EXPORT_NOT_CANCELLABLE",
        "لا يمكن إلغاء مهمة التصدير بعد دخولها مرحلة التحقق النهائية.",
      );
    }
    return cancelled;
  }

  async claimAndProcess(
    workerId: string,
    leaseMilliseconds = 5 * 60_000,
  ): Promise<ExportJob | null> {
    const claimedAt = this.now();
    const job = await this.repository.claimNext(
      workerId,
      claimedAt.toISOString(),
      new Date(claimedAt.getTime() + leaseMilliseconds).toISOString(),
    );
    if (!job) return null;
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      const heartbeatAt = this.now();
      void this.repository
        .updateClaim(
          job.id,
          workerId,
          {
            leaseExpiresAt: new Date(
              heartbeatAt.getTime() + leaseMilliseconds,
            ).toISOString(),
          },
          heartbeatAt.toISOString(),
        )
        .then((updated) => {
          if (!updated) leaseLost = true;
        })
        .catch(() => {
          leaseLost = true;
        });
    }, Math.max(10_000, Math.floor(leaseMilliseconds / 3)));
    heartbeat.unref();
    try {
      const completed = await this.generateArtifact(
        job,
        job.projectKind,
        job.namingPresetId,
        workerId,
      );
      if (leaseLost && completed.status !== "ready") {
        throw new ExportLeaseLostError();
      }
      return completed;
    } catch (error) {
      if (error instanceof ExportLeaseLostError) {
        return this.repository.findById(job.id);
      }
      const now = this.now();
      if (error instanceof ExportDomainError) {
        return (
          (await this.repository.updateClaim(
            job.id,
            workerId,
            {
              status: "failed",
              errorCode: error.code,
              leaseOwner: null,
              leaseExpiresAt: null,
            },
            now.toISOString(),
          )) ?? this.repository.findById(job.id)
        );
      }
      const retryDelay = Math.min(60_000, 2 ** job.attempt * 1_000);
      return (
        (await this.repository.retryOrFailClaim(
          job.id,
          workerId,
          exportErrorCode(error),
          new Date(now.getTime() + retryDelay).toISOString(),
          now.toISOString(),
        )) ?? this.repository.findById(job.id)
      );
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async generateArtifact(
    job: ExportJob,
    projectKind: ProjectKind,
    namingPresetId: string,
    workerId?: string,
  ): Promise<ExportJob> {
    if (!this.storage || !this.layerDocuments) {
      throw new Error("Object storage and LayerDocument persistence are required.");
    }
    const document = await this.layerDocuments.findBySource(
      job.projectId,
      job.sourceVersionId,
    );
    if (!document) {
      throw new ExportDomainError(
        "EXPORT_DOCUMENT_NOT_READY",
        "يجب إكمال معالجة وثيقة الطبقات قبل التصدير.",
      );
    }
    if (
      job.documentRevision !== undefined &&
      (document.revision ?? 1) !== job.documentRevision
    ) {
      throw new ExportDomainError(
        "EXPORT_DOCUMENT_REVISION_CONFLICT",
        "تغيرت وثيقة الطبقات بعد إنشاء مهمة التصدير. أنشئ تصديرًا جديدًا من أحدث مراجعة.",
      );
    }
    const issues = validateProductionDocument(document, projectKind);
    if (issues.length > 0) {
      throw new ExportDomainError(
        "EXPORT_PREFLIGHT_FAILED",
        issues[0]?.message ?? "فشل فحص وثيقة الطبقات.",
      );
    }

    const generating = await this.transition(
      job,
      "generating",
      35,
      workerId,
    );
    let artifact: GeneratedArtifact;
    try {
      artifact = await this.createArtifact(
        job,
        projectKind,
        document,
        namingPresetId,
      );
    } catch (error) {
      if (error instanceof ExportAdapterError) {
        throw new ExportDomainError(
          "EXPORT_PREFLIGHT_FAILED",
          error.message,
        );
      }
      throw error;
    }
    const verifying = await this.transition(
      generating,
      "verifying",
      90,
      workerId,
    );
    const expiresAt = new Date(
      this.now().getTime() + 24 * 60 * 60_000,
    ).toISOString();
    const ready: ExportJob = {
      ...verifying,
      status: "ready",
      progress: 100,
      updatedAt: this.now().toISOString(),
      artifact: {
        filename: artifact.filename,
        sizeBytes: artifact.body.byteLength,
        sha256: createHash("sha256").update(artifact.body).digest("hex"),
        expiresAt,
      },
      leaseOwner: workerId ? null : verifying.leaseOwner,
      leaseExpiresAt: workerId ? null : verifying.leaseExpiresAt,
      errorCode: null,
    };
    await this.storage.put({
      key: this.artifactKey(ready),
      contentType: artifact.contentType,
      sizeBytes: artifact.body.byteLength,
      body: artifact.body,
    });
    if (!workerId) {
      await this.repository.save(ready);
      return ready;
    }
    const persisted = await this.repository.updateClaim(
      ready.id,
      workerId,
      ready,
      ready.updatedAt,
    );
    if (!persisted) {
      await this.storage.delete(this.artifactKey(ready));
      throw new ExportLeaseLostError();
    }
    return persisted;
  }

  private async createArtifact(
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
      body: Buffer.from(zipSync(entries, { level: 6 })),
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
    entries["manifest.json"] = strToU8(
      JSON.stringify(
        createManifest(
          job,
          document,
          namingPresetId,
          sourceFilename,
          upload.sha256,
          layerFiles,
        ),
        null,
        2,
      ),
    );

    return {
      body: Buffer.from(zipSync(entries, { level: 6 })),
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
          await sharp({
            create: {
              width: Math.ceil(page.width),
              height: Math.ceil(page.height),
              channels: 4,
              background: "#ffffff",
            },
          })
            .png({ compressionLevel: 9 })
            .toBuffer(),
        );
        layerFiles.set(background.id, filename);
      }
    }

    const manifest = createManifest(
      job,
      document,
      namingPresetId,
      sourceFilename,
      upload.sha256,
      layerFiles,
    );
    entries["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
    return {
      body: Buffer.from(zipSync(entries, { level: 6 })),
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
    const object = await this.storage.get(upload.objectKey);
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
    if (!this.storage) {
      throw new Error("Object storage is required.");
    }
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
          const object = await this.storage!.get(reference.objectKey);
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

  private artifactKey(job: ExportJob): string {
    return `artifacts/${job.projectId}/${job.id}/${job.artifact?.filename ?? "pending"}`;
  }

  private async transition(
    job: ExportJob,
    status: ExportJob["status"],
    progress: number,
    workerId?: string,
  ): Promise<ExportJob> {
    const updated = {
      ...job,
      status,
      progress,
      updatedAt: this.now().toISOString(),
    };
    if (!workerId) {
      await this.repository.save(updated);
      return updated;
    }
    const persisted = await this.repository.updateClaim(
      job.id,
      workerId,
      { status, progress },
      updated.updatedAt,
    );
    if (!persisted) throw new ExportLeaseLostError();
    return persisted;
  }

  private async fail(job: ExportJob, errorCode: string): Promise<void> {
    await this.repository.save({
      ...job,
      status: "failed",
      errorCode,
      updatedAt: this.now().toISOString(),
    });
  }
}

class ExportLeaseLostError extends Error {
  constructor() {
    super("Export job lease was lost or the job was cancelled.");
  }
}

function exportErrorCode(error: unknown): string {
  if (error instanceof ExportDomainError) return error.code;
  if (error instanceof ExportAdapterError) return error.code;
  return "EXPORT_WORKER_FAILED";
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
