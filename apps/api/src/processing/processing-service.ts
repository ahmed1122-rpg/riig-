import type {
  GuidedRefinementResult,
  ImageGuidanceStroke,
  LayerDocumentEditResult,
  LayerDocument,
  LayerDocumentCommand,
  LayerStateUpdate,
  PdfMarkerRegion,
  ProcessingJob,
  ProjectKind,
  TraceContext,
} from "@motionprep/contracts";
import {
  applyPdfMarkerRegions,
  createImageGuidanceStroke,
  createPdfMarkerRegion,
  guidanceBounds,
} from "@motionprep/guidance";
import { validateProductionDocument } from "@motionprep/layer-domain";
import {
  InMemoryIdempotencyStore,
  type IdempotencyStore,
} from "../idempotency/idempotency-store.js";
import type {
  ObjectStorage,
  StoredObject,
} from "../storage/object-storage.js";
import type { UploadRepository } from "../uploads/upload-repository.js";
import type {
  LayerDocumentRepository,
  ProcessingJobRepository,
} from "./processing-repository.js";
import { InlineProcessingRunner } from "./inline-processing-runner.js";
import { ProcessingDomainError } from "./processing-errors.js";
import {
  DocumentEditCoordinator,
  layerEditRequestHash,
} from "./document-edit-coordinator.js";
import { RasterAssetStore } from "./raster-asset-store.js";
import {
  ImageLayerOperations,
  type MergeImageLayersInput,
  type RefineImageLayerEdgesInput,
} from "./image-layer-operations.js";
import {
  PdfLayerOperations,
  type MergePdfTextLayersInput,
  type NavigateEditHistoryInput,
  type SplitPdfTextLayerInput,
} from "./pdf-layer-operations.js";
import { LayerStateOperations } from "./layer-state-operations.js";
import { LayerCommandOperations } from "./layer-command-operations.js";
import { cleanupRasterAssets } from "./raster-asset-cleanup.js";
import type { GuidedRefinementInput } from "./guided-refinement-input.js";
import type { ProcessingServiceRuntimeOptions } from "./processing-service-options.js";
import { createAndRunProcessingJob } from "./processing-job-creation.js";
export { ProcessingDomainError } from "./processing-errors.js";

export class ProcessingService {
  readonly #inlineRunner: InlineProcessingRunner;
  readonly #edits: DocumentEditCoordinator;
  readonly #rasterAssets: RasterAssetStore;
  readonly #imageLayers: ImageLayerOperations;
  readonly #pdfLayers: PdfLayerOperations;
  readonly #layerStates: LayerStateOperations;
  readonly #layerCommands: LayerCommandOperations;

  constructor(
    private readonly jobs: ProcessingJobRepository,
    private readonly documents: LayerDocumentRepository,
    private readonly uploads: UploadRepository,
    private readonly storage: ObjectStorage,
    private readonly now: () => Date = () => new Date(),
    private readonly idempotency: IdempotencyStore =
      new InMemoryIdempotencyStore(),
    private readonly executeInline = true,
    private readonly runtime: ProcessingServiceRuntimeOptions = {},
  ) {
    this.#inlineRunner = new InlineProcessingRunner(
      jobs,
      documents,
      uploads,
      storage,
      now,
      runtime.pdfOcrEngine,
      runtime.onAssetCleanupError,
      runtime.rasterAssetWriteConcurrency ?? 2,
      runtime.onAssetWriteObservation,
      runtime.onAssetWriteObservationError,
      runtime.derivedAssets,
    );
    this.#edits = new DocumentEditCoordinator(documents, now);
    this.#rasterAssets = new RasterAssetStore(storage, runtime.derivedAssets);
    this.#imageLayers = new ImageLayerOperations(
      this.#edits,
      this.#rasterAssets,
      storage,
      runtime.onAssetCleanupError,
    );
    this.#pdfLayers = new PdfLayerOperations(this.#edits, documents);
    this.#layerStates = new LayerStateOperations(this.#edits, documents);
    this.#layerCommands = new LayerCommandOperations(this.#edits);
  }

  get settlesProjectReviewAtomically(): boolean {
    return this.documents.settlesProjectReviewAtomically === true;
  }

  async createAndRun(
    projectId: string,
    sourceVersionId: string,
    projectKind: ProjectKind,
    options: ProcessingJob["options"],
    idempotencyKey: string,
    ownerUserId?: string,
    onQueued?: (job: ProcessingJob) => Promise<boolean>,
    correlationId?: string,
    traceContext?: TraceContext,
  ): Promise<ProcessingJob> {
    return createAndRunProcessingJob(
      {
        jobs: this.jobs,
        uploads: this.uploads,
        idempotency: this.idempotency,
        inlineRunner: this.#inlineRunner,
        now: this.now,
        executeInline: this.executeInline,
        runtime: this.runtime,
      },
      projectId,
      sourceVersionId,
      projectKind,
      options,
      idempotencyKey,
      ownerUserId,
      onQueued,
      correlationId,
      traceContext,
    );
  }

  async findJob(id: string): Promise<ProcessingJob> {
    const job = await this.jobs.findById(id);
    if (!job) {
      throw new ProcessingDomainError(
        "PROCESSING_NOT_FOUND",
        "مهمة المعالجة غير موجودة.",
      );
    }
    return job;
  }

  async findDocument(
    projectId: string,
    sourceVersionId?: string,
  ): Promise<LayerDocument> {
    const document = sourceVersionId
      ? await this.documents.findBySource(projectId, sourceVersionId)
      : await this.documents.findLatestByProject(projectId);
    if (!document) {
      throw new ProcessingDomainError(
        "DOCUMENT_NOT_FOUND",
        "وثيقة الطبقات غير موجودة أو لم تكتمل معالجتها.",
      );
    }
    return document;
  }

  async findRasterAsset(
    projectId: string,
    sourceVersionId: string,
    layerId: string,
  ): Promise<StoredObject & { sha256: string }> {
    const document = await this.findDocument(projectId, sourceVersionId);
    const reference = document.layers.find(
      (layer) => layer.id === layerId && layer.kind === "raster",
    )?.rasterAsset;
    if (!reference) {
      throw new ProcessingDomainError(
        "LAYER_ASSET_NOT_FOUND",
        "أصل طبقة الصورة غير موجود.",
      );
    }
    const object = await this.#rasterAssets.load(reference);
    if (!object) {
      throw new ProcessingDomainError(
        "LAYER_ASSET_NOT_FOUND",
        "أصل طبقة الصورة غير متاح في التخزين.",
      );
    }
    return { ...object, sha256: reference.sha256 };
  }

  async updateLayerStates(
    projectId: string,
    sourceVersionId: string,
    projectKind: ProjectKind,
    baseRevision: number,
    updates: readonly LayerStateUpdate[],
    actorUserId = "system",
    operationId: string = crypto.randomUUID(),
  ): Promise<LayerDocument> {
    return this.#layerStates.update({
      projectId,
      sourceVersionId,
      projectKind,
      baseRevision,
      updates,
      actorUserId,
      operationId,
    });
  }

  async applyLayerCommand(
    projectId: string,
    sourceVersionId: string,
    projectKind: ProjectKind,
    baseRevision: number,
    command: LayerDocumentCommand,
    actorUserId = "system",
    operationId: string = crypto.randomUUID(),
  ): Promise<LayerDocument> {
    return this.#layerCommands.apply({
      projectId,
      sourceVersionId,
      projectKind,
      baseRevision,
      command,
      actorUserId,
      operationId,
    });
  }

  async applyGuidedRefinement(
    input: GuidedRefinementInput,
  ): Promise<GuidedRefinementResult> {
    const document = await this.findDocument(
      input.projectId,
      input.sourceVersionId,
    );
    const operationId = input.operationId ?? crypto.randomUUID();
    const requestHash = layerEditRequestHash("guided-refinement", {
      ...input,
      operationId,
    });
    if (input.operationId) {
      const replay = await this.#edits.findReplay(
        document,
        operationId,
        "guided-refinement",
        requestHash,
      );
      if (replay) {
        return {
          document: replay.document,
          affectedLayerIds: replay.entry.affectedLayerIds ?? [],
          createdLayerIds: replay.entry.createdLayerIds ?? [],
          warnings: replay.document.guidance?.warnings ?? [],
        };
      }
    }
    const currentRevision = document.revision ?? 1;
    if (currentRevision !== input.baseRevision) {
      throw new ProcessingDomainError(
        "DOCUMENT_REVISION_CONFLICT",
        "تغيرت وثيقة الطبقات منذ فتح أداة التحديد. أعد تحميلها قبل التطبيق.",
      );
    }

    let imageStrokes: ImageGuidanceStroke[];
    let pdfRegions: PdfMarkerRegion[];
    try {
      imageStrokes = input.imageStrokes.map((stroke) =>
        createImageGuidanceStroke(stroke),
      );
      pdfRegions = input.pdfRegions.map((region) =>
        createPdfMarkerRegion(region),
      );
    } catch {
      throw new ProcessingDomainError(
        "GUIDANCE_INVALID",
        "بيانات القلم أو منطقة PDF غير صالحة.",
      );
    }
    if (
      (input.projectKind === "image" &&
        (imageStrokes.length === 0 || pdfRegions.length > 0)) ||
      (input.projectKind === "book" &&
        (pdfRegions.length === 0 || imageStrokes.length > 0))
    ) {
      throw new ProcessingDomainError(
        "GUIDANCE_INVALID",
        "نوع الإرشاد لا يطابق نوع المشروع.",
      );
    }

    const existingGuidance = document.guidance;
    const existingIds = new Set([
      ...(existingGuidance?.imageStrokes.map((stroke) => stroke.id) ?? []),
      ...(existingGuidance?.pdfRegions.map((region) => region.id) ?? []),
    ]);
    const incomingIds = [
      ...imageStrokes.map((stroke) => stroke.id),
      ...pdfRegions.map((region) => region.id),
    ];
    if (
      new Set(incomingIds).size !== incomingIds.length ||
      incomingIds.some((id) => existingIds.has(id))
    ) {
      throw new ProcessingDomainError(
        "GUIDANCE_DUPLICATE",
        "تم تطبيق أحد معرّفات الإرشاد من قبل.",
      );
    }

    const storedKeys: string[] = [];
    try {
      const applied: {
        document: LayerDocument;
        affectedLayerIds: string[];
        createdLayerIds: string[];
        warnings: string[];
        storedKeys?: string[];
      } =
        input.projectKind === "book"
          ? applyPdfMarkerRegions(document, pdfRegions)
          : await this.#imageLayers.applyGuidance(
              document,
              imageStrokes,
              currentRevision + 1,
              operationId,
            );
      if (applied.storedKeys) storedKeys.push(...applied.storedKeys);
      const {
        document: guidedDocument,
        affectedLayerIds,
        createdLayerIds,
        warnings,
      } = applied;

      const allImageStrokes = [
        ...(existingGuidance?.imageStrokes ?? []),
        ...imageStrokes,
      ];
      const allPdfRegions = [
        ...(existingGuidance?.pdfRegions ?? []),
        ...pdfRegions,
      ];
      const allPoints = [
        ...allImageStrokes.flatMap((stroke) => stroke.points),
        ...allPdfRegions.flatMap((region) => [region.start, region.end]),
      ];
      const changed: LayerDocument = {
        ...guidedDocument,
        guidance: {
          revision: (existingGuidance?.revision ?? 0) + 1,
          mode: input.mode,
          imageStrokes: allImageStrokes,
          pdfRegions: allPdfRegions,
          affectedBounds: guidanceBounds(allPoints),
          appliedAt: this.now().toISOString(),
          warnings,
        },
      };
      const updated = this.#edits.withTimeline(changed, document, {
        kind: "guided-refinement",
        actorUserId: input.actorUserId ?? "system",
        operationId,
        requestHash,
      });
      const issues = validateProductionDocument(updated, input.projectKind);
      if (issues.length > 0) {
        throw new ProcessingDomainError(
          issues[0]?.code === "IMAGE_LAYER_LIMIT_EXCEEDED"
            ? "IMAGE_LAYER_LIMIT_EXCEEDED"
            : "GUIDANCE_INVALID",
          issues[0]?.message ?? "فشل فحص وثيقة الطبقات بعد التحديد.",
        );
      }
      const saved = await this.documents.saveIfRevision(
        updated,
        currentRevision,
      );
      if (!saved) {
        throw new ProcessingDomainError(
          "DOCUMENT_REVISION_CONFLICT",
          "تغيرت وثيقة الطبقات أثناء تطبيق التحديد. أعد تحميلها ثم حاول مجددًا.",
        );
      }
      return {
        document: updated,
        affectedLayerIds,
        createdLayerIds,
        warnings,
      };
    } catch (error) {
      if (storedKeys.length > 0) {
        await cleanupRasterAssets(
          this.storage,
          storedKeys,
          this.runtime.onAssetCleanupError,
        );
      }
      throw error;
    }
  }

  splitPdfTextLayer(
    input: SplitPdfTextLayerInput,
  ): Promise<LayerDocumentEditResult> {
    return this.#pdfLayers.split(input);
  }

  mergePdfTextLayers(
    input: MergePdfTextLayersInput,
  ): Promise<LayerDocumentEditResult> {
    return this.#pdfLayers.merge(input);
  }

  navigateEditHistory(
    input: NavigateEditHistoryInput,
  ): Promise<LayerDocument> {
    return this.#pdfLayers.navigate(input);
  }

  refineImageLayerEdges(
    input: RefineImageLayerEdgesInput,
  ): Promise<LayerDocumentEditResult> {
    return this.#imageLayers.refineEdges(input);
  }

  mergeImageLayers(
    input: MergeImageLayersInput,
  ): Promise<LayerDocumentEditResult> {
    return this.#imageLayers.merge(input);
  }

}
