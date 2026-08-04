import type { LayerDocument, ProcessingJob } from "@motionprep/contracts";
import {
  DocumentProcessingError,
  preparePdfSource,
  type PdfOcrEngine,
} from "@motionprep/document-processing";
import {
  MediaProcessingError,
  prepareImageSource,
} from "@motionprep/media-processing";
import { hasExpectedObjectIntegrity } from "../storage/object-integrity.js";
import {
  isObjectStorageIntegrityFailure,
  type ObjectStorage,
  type StoredObject,
} from "../storage/object-storage.js";
import type { UploadRepository } from "../uploads/upload-repository.js";
import {
  ProcessingDomainError,
  processingDomainCode,
} from "./processing-errors.js";
import {
  applyPdfRegionOcr,
  PdfRegionOcrError,
} from "./pdf-region-ocr.js";
import type {
  LayerDocumentRepository,
  ProcessingJobRepository,
} from "./processing-repository.js";
import { cleanupRasterAssets } from "./raster-asset-cleanup.js";
import {
  writeRasterAssets,
  type RasterAssetWriteObservation,
} from "./raster-asset-writer.js";

export class InlineProcessingRunner {
  constructor(
    private readonly jobs: ProcessingJobRepository,
    private readonly documents: LayerDocumentRepository,
    private readonly uploads: UploadRepository,
    private readonly storage: ObjectStorage,
    private readonly now: () => Date,
    private readonly pdfOcrEngine?: PdfOcrEngine,
    private readonly onAssetCleanupError?: (
      error: unknown,
      objectKey: string,
    ) => void,
    private readonly rasterAssetWriteConcurrency = 2,
    private readonly onAssetWriteObservation?: (
      observation: RasterAssetWriteObservation,
    ) => void,
    private readonly onAssetWriteObservationError?: (error: unknown) => void,
  ) {}

  async run(job: ProcessingJob): Promise<ProcessingJob> {
    const upload = await this.uploads.findReadyBySourceVersion(
      job.projectId,
      job.sourceVersionId,
    );
    if (!upload) {
      return this.fail(job, "SOURCE_NOT_READY", "نسخة المصدر غير جاهزة.");
    }
    let source: StoredObject | null;
    try {
      source = await this.storage.get(upload.objectKey, {
        maxBytes: upload.expectedSizeBytes,
      });
    } catch (error) {
      if (isObjectStorageIntegrityFailure(error)) {
        return this.fail(
          job,
          "SOURCE_INTEGRITY_FAILED",
          "فشل التحقق من سلامة ملف المصدر المخزن.",
        );
      }
      throw error;
    }
    if (!source) {
      return this.fail(job, "SOURCE_NOT_READY", "ملف المصدر غير متاح.");
    }
    if (
      !upload.sha256 ||
      !hasExpectedObjectIntegrity(source, {
        contentType: upload.contentType,
        sizeBytes: upload.expectedSizeBytes,
        sha256: upload.sha256,
      })
    ) {
      return this.fail(
        job,
        "SOURCE_INTEGRITY_FAILED",
        "فشل التحقق من سلامة ملف المصدر المخزن.",
      );
    }

    const processing = await this.transition(job, "processing", 25);
    let storedRasterAssetKeys: string[] = [];
    let documentSaved = false;
    try {
      let document: LayerDocument;
      let expectedRevision: number | undefined;
      if (job.projectKind === "book") {
        if (job.options.pdfRegionOcr) {
          if (!this.pdfOcrEngine) {
            throw new PdfRegionOcrError(
              "OCR_FAILED",
              "محرك OCR الإقليمي غير متاح في بيئة المعالجة الحالية.",
            );
          }
          const previous = await this.documents.findBySource(
            job.projectId,
            job.sourceVersionId,
          );
          if (!previous) {
            throw new PdfRegionOcrError(
              "INVALID_DOCUMENT_OPERATION",
              "يجب تجهيز وثيقة PDF قبل تشغيل OCR الإقليمي.",
            );
          }
          const result = await applyPdfRegionOcr({
            source: source.body,
            document: previous,
            operation: job.options.pdfRegionOcr,
            ocrEngine: this.pdfOcrEngine,
            now: this.now,
          });
          document = result.document;
          expectedRevision = job.options.pdfRegionOcr.baseRevision;
        } else {
          document = await preparePdfSource({
            projectId: job.projectId,
            sourceVersionId: job.sourceVersionId,
            source: source.body,
            separationMode: job.options.pdfSeparationMode ?? "sentence",
            ...(this.pdfOcrEngine ? { ocrEngine: this.pdfOcrEngine } : {}),
          });
        }
      } else {
        const prepared = await prepareImageSource({
          projectId: job.projectId,
          sourceVersionId: job.sourceVersionId,
          source: source.body,
        });
        storedRasterAssetKeys = await writeRasterAssets(
          this.storage,
          prepared.rasterAssets,
          {
            concurrency: this.rasterAssetWriteConcurrency,
            ...(this.onAssetCleanupError
              ? { onCleanupError: this.onAssetCleanupError }
              : {}),
            ...(this.onAssetWriteObservation
              ? { onObservation: this.onAssetWriteObservation }
              : {}),
            ...(this.onAssetWriteObservationError
              ? { onObservationError: this.onAssetWriteObservationError }
              : {}),
          },
        );
        document = prepared.document;
      }
      if (expectedRevision === undefined) {
        const previousDocument = await this.documents.findBySource(
          job.projectId,
          job.sourceVersionId,
        );
        document = {
          ...document,
          revision: (previousDocument?.revision ?? 0) + 1,
        };
      }
      const verifying = await this.transition(processing, "verifying", 85);
      if (expectedRevision === undefined) {
        await this.documents.save(document);
      } else {
        const saved = await this.documents.saveIfRevision(
          document,
          expectedRevision,
        );
        if (!saved) {
          throw new ProcessingDomainError(
            "DOCUMENT_REVISION_CONFLICT",
            "تغيرت وثيقة الطبقات أثناء تنفيذ العملية. أعد المحاولة من أحدث مراجعة.",
          );
        }
      }
      documentSaved = true;
      return this.transition(verifying, "ready", 100);
    } catch (error) {
      if (!documentSaved && storedRasterAssetKeys.length > 0) {
        await cleanupRasterAssets(
          this.storage,
          storedRasterAssetKeys,
          this.onAssetCleanupError,
        );
      }
      if (error instanceof DocumentProcessingError) {
        return this.fail(processing, error.code, error.message);
      }
      if (error instanceof PdfRegionOcrError) {
        return this.fail(processing, error.code, error.message);
      }
      if (error instanceof ProcessingDomainError) {
        return this.fail(processing, error.code, error.message);
      }
      const code =
        error instanceof MediaProcessingError
          ? error.code
          : "PROCESSING_FAILED";
      return this.fail(
        processing,
        code,
        "تعذر تجهيز وثيقة الطبقات.",
      );
    }
  }

  private async transition(
    job: ProcessingJob,
    status: ProcessingJob["status"],
    progress: number,
  ): Promise<ProcessingJob> {
    const updated = {
      ...job,
      status,
      progress,
      updatedAt: this.now().toISOString(),
    };
    await this.jobs.save(updated);
    return updated;
  }

  private async fail(
    job: ProcessingJob,
    code: string,
    message: string,
  ): Promise<never> {
    await this.jobs.save({
      ...job,
      status: "failed",
      errorCode: code,
      updatedAt: this.now().toISOString(),
    });
    throw new ProcessingDomainError(processingDomainCode(code), message, job.id);
  }
}
