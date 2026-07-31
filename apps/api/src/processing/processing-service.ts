import { createHash } from "node:crypto";
import type {
  GuidedRefinementResult,
  ImageGuidanceStroke,
  LayerDocumentEditResult,
  LayerEditKind,
  LayerDocument,
  LayerNode,
  LayerStateUpdate,
  PdfMarkerRegion,
  ProcessingJob,
  ProcessingMode,
  ProjectKind,
  RasterAssetReference,
} from "@motionprep/contracts";
import { MAX_IMAGE_LAYERS } from "@motionprep/contracts";
import {
  DocumentProcessingError,
  preparePdfSource,
  type PdfOcrEngine,
} from "@motionprep/document-processing";
import {
  applyRasterGuidance,
  MediaProcessingError,
  mergeRasterLayers,
  prepareImageSource,
  refineRasterEdges,
  type PreparedRasterAsset,
} from "@motionprep/media-processing";
import {
  applyPdfMarkerRegions,
  createImageGuidanceStroke,
  createPdfMarkerRegion,
  guidanceBounds,
} from "@motionprep/guidance";
import {
  createPdfTextLayerName,
  normalizeLayerName,
  validateProductionDocument,
} from "@motionprep/presets";
import {
  InMemoryIdempotencyStore,
  type IdempotencyStore,
} from "../idempotency/idempotency-store.js";
import {
  isObjectStorageIntegrityFailure,
  type ObjectStorage,
  type StoredObject,
} from "../storage/object-storage.js";
import { hasExpectedObjectIntegrity } from "../storage/object-integrity.js";
import type { UploadRepository } from "../uploads/upload-repository.js";
import type {
  LayerDocumentRepository,
  ProcessingJobRepository,
} from "./processing-repository.js";
import type { UsageMeter } from "../billing/usage-meter.js";
import {
  applyPdfRegionOcr,
  PdfRegionOcrError,
} from "./pdf-region-ocr.js";

type ProcessingDomainErrorCode =
  | "PROCESSING_NOT_FOUND"
  | "PROCESSING_IN_PROGRESS"
  | "SOURCE_NOT_CURRENT"
  | "SOURCE_NOT_READY"
  | "SOURCE_INTEGRITY_FAILED"
  | "DOCUMENT_NOT_FOUND"
  | "DOCUMENT_REVISION_CONFLICT"
  | "EDIT_HISTORY_UNAVAILABLE"
  | "INVALID_DOCUMENT_OPERATION"
  | "INVALID_LAYER_UPDATE"
  | "LAYER_ASSET_NOT_FOUND"
  | "LAYER_ASSET_INTEGRITY_FAILED"
  | "OCR_REQUIRED"
  | "OCR_FAILED"
  | "PDF_DECODE_FAILED"
  | "PDF_TOO_MANY_PAGES"
  | "PDF_TEXT_LIMIT_EXCEEDED"
  | "IMAGE_HAS_NO_VISIBLE_PIXELS"
  | "IMAGE_LAYER_LIMIT_EXCEEDED"
  | "GUIDANCE_INVALID"
  | "GUIDANCE_DUPLICATE"
  | "GUIDANCE_LAYER_UNAVAILABLE"
  | "PROCESSING_FAILED";

export class ProcessingDomainError extends Error {
  constructor(
    readonly code: ProcessingDomainErrorCode,
    message: string,
    readonly jobId?: string,
  ) {
    super(message);
  }
}

export class ProcessingService {
  constructor(
    private readonly jobs: ProcessingJobRepository,
    private readonly documents: LayerDocumentRepository,
    private readonly uploads: UploadRepository,
    private readonly storage: ObjectStorage,
    private readonly now: () => Date = () => new Date(),
    private readonly idempotency: IdempotencyStore =
      new InMemoryIdempotencyStore(),
    private readonly executeInline = true,
    private readonly pdfOcrEngine?: PdfOcrEngine,
    private readonly usageMeter?: UsageMeter,
  ) {}

  async createAndRun(
    projectId: string,
    sourceVersionId: string,
    projectKind: ProjectKind,
    options: ProcessingJob["options"],
    idempotencyKey: string,
    ownerUserId?: string,
    onQueued?: (job: ProcessingJob) => Promise<boolean>,
  ): Promise<ProcessingJob> {
    const source = await this.uploads.findReadyBySourceVersion(
      projectId,
      sourceVersionId,
    );
    if (!source) {
      throw new ProcessingDomainError(
        "SOURCE_NOT_READY",
        "نسخة المصدر لا تتبع المشروع أو لم تكتمل جاهزيتها.",
      );
    }
    const existing = await this.jobs.findBySource(projectId, sourceVersionId);
    if (existing) {
      const existingRegional = existing.options.pdfRegionOcr;
      const requestedRegional = options.pdfRegionOcr;
      if (!existingRegional && !requestedRegional) return existing;
      if (
        existingRegional &&
        requestedRegional &&
        existingRegional.operationId === requestedRegional.operationId
      ) {
        return existing;
      }
      throw new ProcessingDomainError(
        "PROCESSING_IN_PROGRESS",
        "توجد مهمة معالجة نشطة لهذا المصدر. انتظر اكتمالها ثم أعد المحاولة.",
      );
    }

    const id = crypto.randomUUID();
    const claimed = await this.idempotency.claim(
      "processing",
      `${projectId}:${sourceVersionId}:${idempotencyKey}`,
      id,
      24 * 60 * 60,
    );
    if (claimed !== id) {
      const repeated = await this.jobs.findById(claimed);
      if (repeated) return repeated;
    }

    const timestamp = this.now().toISOString();
    const job: ProcessingJob = {
      id,
      projectId,
      sourceVersionId,
      projectKind,
      options,
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
    let reserved = false;
    if (ownerUserId && this.usageMeter) {
      await this.usageMeter.reserveJob(ownerUserId, job.id);
      reserved = true;
    }
    try {
      await this.jobs.save(job);
    } catch (error) {
      if (reserved) await this.usageMeter?.releaseJob(job.id);
      throw error;
    }
    if (onQueued && !(await onQueued(job))) {
      await this.jobs.save({
        ...job,
        status: "failed",
        errorCode: "SOURCE_NOT_CURRENT",
        updatedAt: this.now().toISOString(),
      });
      if (reserved) await this.usageMeter?.releaseJob(job.id);
      throw new ProcessingDomainError(
        "SOURCE_NOT_CURRENT",
        "تغير إصدار المصدر الحالي قبل إدخال المهمة إلى الطابور.",
        job.id,
      );
    }
    if (!this.executeInline) return job;
    const startedAt = Date.now();
    try {
      return await this.run(job);
    } finally {
      await this.usageMeter?.recordProcessingSeconds(
        job.id,
        1,
        Math.max(1, Math.ceil((Date.now() - startedAt) / 1_000)),
      );
    }
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
  ): Promise<StoredObject> {
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
    const object = await this.loadRasterObject(reference);
    if (!object) {
      throw new ProcessingDomainError(
        "LAYER_ASSET_NOT_FOUND",
        "أصل طبقة الصورة غير متاح في التخزين.",
      );
    }
    return object;
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
    const document = await this.findDocument(projectId, sourceVersionId);
    const currentRevision = document.revision ?? 1;
    if (currentRevision !== baseRevision) {
      throw new ProcessingDomainError(
        "DOCUMENT_REVISION_CONFLICT",
        "تغيرت وثيقة الطبقات منذ فتح المراجعة. أعد تحميلها قبل الحفظ.",
      );
    }

    const updatesById = new Map<string, LayerStateUpdate>();
    for (const update of updates) {
      if (
        updatesById.has(update.id) ||
        !isValidLayerName(update.name) ||
        !Number.isFinite(update.opacity) ||
        update.opacity < 0 ||
        update.opacity > 1 ||
        !Number.isSafeInteger(update.zIndex) ||
        update.zIndex < 0 ||
        update.zIndex > 1_000_000 ||
        (update.readingOrder !== undefined &&
          (!Number.isSafeInteger(update.readingOrder) ||
            update.readingOrder < 0 ||
            update.readingOrder > 1_000_000))
      ) {
        throw new ProcessingDomainError(
          "INVALID_LAYER_UPDATE",
          "تحديثات الطبقات غير صالحة.",
        );
      }
      updatesById.set(update.id, update);
    }

    const layersById = new Map(
      document.layers.map((layer) => [layer.id, layer]),
    );
    const knownIds = new Set(layersById.keys());
    if ([...updatesById.keys()].some((id) => !knownIds.has(id))) {
      throw new ProcessingDomainError(
        "INVALID_LAYER_UPDATE",
        "تتضمن المراجعة طبقة لا تنتمي إلى وثيقة المصدر الحالية.",
      );
    }
    for (const change of updatesById.values()) {
      const current = layersById.get(change.id);
      if (
        current?.fixed &&
        (change.name !== current.name ||
          change.visible !== current.visible ||
          change.locked !== current.locked ||
          change.opacity !== current.opacity ||
          change.zIndex !== current.zIndex ||
          change.readingOrder !== current.readingOrder)
      ) {
        throw new ProcessingDomainError(
          "INVALID_LAYER_UPDATE",
          "لا يمكن تعديل أو إعادة ترتيب طبقة خلفية PDF الثابتة.",
        );
      }
    }

    const changed: LayerDocument = {
      ...document,
      layers: document.layers.map((layer) => {
        const change = updatesById.get(layer.id);
        return change
          ? {
              ...layer,
              name: change.name,
              visible: change.visible,
              locked: change.locked,
              opacity: change.opacity,
              zIndex: change.zIndex,
              ...(change.readingOrder === undefined
                ? {}
                : { readingOrder: change.readingOrder }),
            }
          : layer;
      }),
    };
    const updated = this.withEditTimeline(changed, document, {
      kind: "layer-state",
      actorUserId,
      operationId,
    });
    const issues = validateProductionDocument(updated, projectKind);
    if (issues.length > 0) {
      throw new ProcessingDomainError(
        "INVALID_LAYER_UPDATE",
        issues[0]?.message ?? "فشل فحص وثيقة الطبقات بعد التعديل.",
      );
    }

    const saved = await this.documents.saveIfRevision(
      updated,
      currentRevision,
    );
    if (!saved) {
      throw new ProcessingDomainError(
        "DOCUMENT_REVISION_CONFLICT",
        "تغيرت وثيقة الطبقات أثناء الحفظ. أعد تحميلها ثم حاول مجددًا.",
      );
    }
    return updated;
  }

  async applyGuidedRefinement(input: {
    projectId: string;
    sourceVersionId: string;
    projectKind: ProjectKind;
    baseRevision: number;
    mode: ProcessingMode;
    imageStrokes: readonly ImageGuidanceStroke[];
    pdfRegions: readonly PdfMarkerRegion[];
    actorUserId?: string;
    operationId?: string;
  }): Promise<GuidedRefinementResult> {
    const document = await this.findDocument(
      input.projectId,
      input.sourceVersionId,
    );
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
          : await this.applyImageStrokes(
              document,
              imageStrokes,
              currentRevision + 1,
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
      const updated = this.withEditTimeline(changed, document, {
        kind: "guided-refinement",
        actorUserId: input.actorUserId ?? "system",
        operationId: input.operationId ?? crypto.randomUUID(),
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
        await Promise.allSettled(
          storedKeys.map((key) => this.storage.delete(key)),
        );
      }
      throw error;
    }
  }

  async splitPdfTextLayer(input: {
    projectId: string;
    sourceVersionId: string;
    baseRevision: number;
    layerId: string;
    offset: number;
    actorUserId: string;
    operationId: string;
  }): Promise<LayerDocumentEditResult> {
    const document = await this.findDocument(
      input.projectId,
      input.sourceVersionId,
    );
    const replay = await this.findOperationReplay(
      document,
      input.operationId,
      "pdf-split",
    );
    if (replay) {
      return {
        document: replay.document,
        affectedLayerIds: replay.entry.affectedLayerIds ?? [input.layerId],
        createdLayerIds: replay.entry.createdLayerIds ?? [],
        removedLayerIds: replay.entry.removedLayerIds ?? [],
      };
    }
    if ((document.revision ?? 1) !== input.baseRevision) {
      throw revisionConflict();
    }
    if (!document.pages?.length) {
      throw invalidDocumentOperation("تقسيم النص متاح لمستندات PDF فقط.");
    }
    const layer = document.layers.find(
      (candidate) => candidate.id === input.layerId,
    );
    if (
      !layer ||
      layer.kind !== "text" ||
      layer.fixed ||
      layer.locked ||
      layer.pageNumber === undefined ||
      !layer.fullText ||
      !layer.bounds
    ) {
      throw invalidDocumentOperation(
        "اختر طبقة نصية غير مقفلة لها نص وحدود صالحة قبل التقسيم.",
      );
    }
    const characters = Array.from(layer.fullText);
    if (
      !Number.isSafeInteger(input.offset) ||
      input.offset <= 0 ||
      input.offset >= characters.length
    ) {
      throw invalidDocumentOperation(
        "يجب أن يقع موضع التقسيم بين أول وآخر حرف في الوحدة النصية.",
      );
    }
    const firstText = characters.slice(0, input.offset).join("");
    const secondText = characters.slice(input.offset).join("");
    if (!firstText.trim() || !secondText.trim()) {
      throw invalidDocumentOperation(
        "لا يمكن إنشاء جزء نصي فارغ أو مكوّن من مسافات فقط.",
      );
    }
    const ratio = input.offset / characters.length;
    const firstWidth = layer.bounds.width * ratio;
    const secondWidth = layer.bounds.width - firstWidth;
    const rtl = layer.direction === "rtl";
    const firstBounds = {
      ...layer.bounds,
      x: rtl ? layer.bounds.x + secondWidth : layer.bounds.x,
      width: firstWidth,
    };
    const secondBounds = {
      ...layer.bounds,
      x: rtl ? layer.bounds.x : layer.bounds.x + firstWidth,
      width: secondWidth,
    };
    const createdLayerId = crypto.randomUUID();
    const first: LayerNode = {
      ...layer,
      name: createPdfTextLayerName(firstText, "sentence"),
      fullText: firstText,
      bounds: firstBounds,
    };
    const second: LayerNode = {
      ...layer,
      id: createdLayerId,
      name: createPdfTextLayerName(secondText, "sentence"),
      fullText: secondText,
      bounds: secondBounds,
      zIndex: layer.zIndex + 1,
      readingOrder: (layer.readingOrder ?? 0) + 1,
    };
    const layers = document.layers.flatMap((candidate) =>
      candidate.id === layer.id ? [first, second] : [candidate],
    );
    const changed = {
      ...document,
      layers: normalizePageReadingOrder(layers, layer.pageNumber),
    };
    const updated = await this.saveDocumentOperation(
      document,
      changed,
      "pdf-split",
      input.actorUserId,
      input.operationId,
      {
        affectedLayerIds: [layer.id],
        createdLayerIds: [createdLayerId],
        removedLayerIds: [],
      },
    );
    return {
      document: updated,
      affectedLayerIds: [layer.id],
      createdLayerIds: [createdLayerId],
      removedLayerIds: [],
    };
  }

  async mergePdfTextLayers(input: {
    projectId: string;
    sourceVersionId: string;
    baseRevision: number;
    layerIds: readonly string[];
    separator: "space" | "newline";
    actorUserId: string;
    operationId: string;
  }): Promise<LayerDocumentEditResult> {
    const document = await this.findDocument(
      input.projectId,
      input.sourceVersionId,
    );
    const replay = await this.findOperationReplay(
      document,
      input.operationId,
      "pdf-merge",
    );
    if (replay) {
      return {
        document: replay.document,
        affectedLayerIds: replay.entry.affectedLayerIds ?? [...input.layerIds],
        createdLayerIds: replay.entry.createdLayerIds ?? [],
        removedLayerIds:
          replay.entry.removedLayerIds ?? input.layerIds.slice(1),
      };
    }
    if ((document.revision ?? 1) !== input.baseRevision) {
      throw revisionConflict();
    }
    if (!document.pages?.length) {
      throw invalidDocumentOperation("دمج النص متاح لمستندات PDF فقط.");
    }
    const uniqueIds = [...new Set(input.layerIds)];
    if (uniqueIds.length < 2 || uniqueIds.length > 50) {
      throw invalidDocumentOperation(
        "اختر من طبقتين إلى خمسين طبقة نصية للدمج.",
      );
    }
    const selected = uniqueIds.map((id) =>
      document.layers.find((layer) => layer.id === id),
    );
    if (
      selected.some(
        (layer) =>
          !layer ||
          layer.kind !== "text" ||
          layer.fixed ||
          layer.locked ||
          layer.pageNumber === undefined ||
          !layer.fullText ||
          !layer.bounds,
      )
    ) {
      throw invalidDocumentOperation(
        "يجب أن تكون كل الوحدات المحددة طبقات نصية غير مقفلة ولها نص وحدود.",
      );
    }
    const textLayers = selected as LayerNode[];
    const pageNumber = textLayers[0]!.pageNumber!;
    const parentId = textLayers[0]!.parentId;
    const direction = textLayers[0]!.direction;
    if (
      textLayers.some(
        (layer) =>
          layer.pageNumber !== pageNumber ||
          layer.parentId !== parentId ||
          layer.direction !== direction,
      )
    ) {
      throw invalidDocumentOperation(
        "لا يمكن دمج نصوص من صفحات أو مجموعات أو اتجاهات كتابة مختلفة.",
      );
    }
    const ordered = [...textLayers].sort(compareTextLayers);
    const separator = input.separator === "newline" ? "\n" : " ";
    const fullText = ordered.map((layer) => layer.fullText!.trim()).join(separator);
    const mergedBounds = unionBounds(ordered.map((layer) => layer.bounds!));
    const survivor = ordered[0]!;
    const removedIds = new Set(ordered.slice(1).map((layer) => layer.id));
    const readingOrders = ordered.flatMap((layer) =>
      layer.readingOrder === undefined ? [] : [layer.readingOrder],
    );
    const merged: LayerNode = {
      ...survivor,
      name: createPdfTextLayerName(fullText, "sentence"),
      fullText,
      bounds: mergedBounds,
      visible: ordered.some((layer) => layer.visible),
      opacity: Math.max(...ordered.map((layer) => layer.opacity)),
      zIndex: Math.min(...ordered.map((layer) => layer.zIndex)),
      ...(readingOrders.length > 0
        ? { readingOrder: Math.min(...readingOrders) }
        : {}),
    };
    const layers = document.layers
      .filter((layer) => !removedIds.has(layer.id))
      .map((layer) => (layer.id === survivor.id ? merged : layer));
    const changed = {
      ...document,
      layers: normalizePageReadingOrder(layers, pageNumber),
    };
    const updated = await this.saveDocumentOperation(
      document,
      changed,
      "pdf-merge",
      input.actorUserId,
      input.operationId,
      {
        affectedLayerIds: uniqueIds,
        createdLayerIds: [],
        removedLayerIds: [...removedIds],
      },
    );
    return {
      document: updated,
      affectedLayerIds: uniqueIds,
      createdLayerIds: [],
      removedLayerIds: [...removedIds],
    };
  }

  async navigateEditHistory(input: {
    projectId: string;
    sourceVersionId: string;
    baseRevision: number;
    direction: "undo" | "redo";
  }): Promise<LayerDocument> {
    const document = await this.requireOperationDocument(
      input.projectId,
      input.sourceVersionId,
      input.baseRevision,
    );
    const timeline = document.editTimeline;
    const targetCursor =
      input.direction === "undo"
        ? (timeline?.cursor ?? 0) - 1
        : (timeline?.cursor ?? -1) + 1;
    const targetEntry = timeline?.entries[targetCursor];
    if (!timeline || !targetEntry) {
      throw new ProcessingDomainError(
        "EDIT_HISTORY_UNAVAILABLE",
        input.direction === "undo"
          ? "لا يوجد تعديل سابق متاح للتراجع."
          : "لا يوجد تعديل تالٍ متاح للإعادة.",
      );
    }
    const snapshot = await this.documents.findRevision(
      input.projectId,
      input.sourceVersionId,
      targetEntry.revision,
    );
    if (!snapshot) {
      throw new ProcessingDomainError(
        "EDIT_HISTORY_UNAVAILABLE",
        "انتهت مدة الاحتفاظ بمراجعة التعديل المطلوبة.",
      );
    }
    const currentRevision = document.revision ?? 1;
    const restored: LayerDocument = {
      ...snapshot,
      revision: currentRevision + 1,
      editTimeline: { ...timeline, cursor: targetCursor },
    };
    const saved = await this.documents.saveIfRevision(
      restored,
      currentRevision,
    );
    if (!saved) throw revisionConflict();
    return restored;
  }

  async refineImageLayerEdges(input: {
    projectId: string;
    sourceVersionId: string;
    baseRevision: number;
    layerId: string;
    radius: 1 | 2 | 3;
    strength: number;
    actorUserId: string;
    operationId: string;
  }): Promise<LayerDocumentEditResult> {
    const document = await this.findDocument(
      input.projectId,
      input.sourceVersionId,
    );
    const replay = await this.findOperationReplay(
      document,
      input.operationId,
      "image-edge-refine",
    );
    if (replay) return editReplayResult(replay);
    if ((document.revision ?? 1) !== input.baseRevision) {
      throw revisionConflict();
    }
    if (!document.imagePreparation) {
      throw invalidDocumentOperation("تحسين الحواف متاح لمشروعات الصور فقط.");
    }
    const layer = document.layers.find(
      (candidate) => candidate.id === input.layerId,
    );
    if (
      !layer ||
      layer.kind !== "raster" ||
      layer.locked ||
      layer.fixed ||
      !layer.rasterAsset
    ) {
      throw invalidDocumentOperation(
        "اختر طبقة Raster غير مقفلة قبل تحسين الحواف.",
      );
    }
    const object = await this.loadRasterObject(layer.rasterAsset);
    if (!object) {
      throw new ProcessingDomainError(
        "LAYER_ASSET_NOT_FOUND",
        "تعذر تحميل أصل طبقة Raster أو التحقق من سلامته.",
      );
    }
    let refined: Buffer;
    try {
      refined = await refineRasterEdges(object.body, {
        radius: input.radius,
        strength: input.strength,
      });
    } catch (error) {
      if (error instanceof MediaProcessingError) {
        throw invalidDocumentOperation(error.message);
      }
      throw error;
    }
    const targetRevision = (document.revision ?? 1) + 1;
    const reference = await this.storeToolRaster(
      document,
      targetRevision,
      "edge-refine",
      layer.id,
      refined,
    );
    try {
      const changed = {
        ...document,
        layers: document.layers.map((candidate) =>
          candidate.id === layer.id
            ? { ...candidate, rasterAsset: reference }
            : candidate,
        ),
      };
      const details = {
        affectedLayerIds: [layer.id],
        createdLayerIds: [],
        removedLayerIds: [],
      };
      const updated = await this.saveDocumentOperation(
        document,
        changed,
        "image-edge-refine",
        input.actorUserId,
        input.operationId,
        details,
        "image",
      );
      return { document: updated, ...details };
    } catch (error) {
      await this.storage.delete(reference.objectKey).catch(() => undefined);
      throw error;
    }
  }

  async mergeImageLayers(input: {
    projectId: string;
    sourceVersionId: string;
    baseRevision: number;
    layerIds: readonly string[];
    actorUserId: string;
    operationId: string;
  }): Promise<LayerDocumentEditResult> {
    const document = await this.findDocument(
      input.projectId,
      input.sourceVersionId,
    );
    const replay = await this.findOperationReplay(
      document,
      input.operationId,
      "image-merge",
    );
    if (replay) return editReplayResult(replay);
    if ((document.revision ?? 1) !== input.baseRevision) {
      throw revisionConflict();
    }
    if (!document.imagePreparation) {
      throw invalidDocumentOperation("دمج Raster متاح لمشروعات الصور فقط.");
    }
    const uniqueIds = [...new Set(input.layerIds)];
    if (uniqueIds.length < 2 || uniqueIds.length > MAX_IMAGE_LAYERS) {
      throw invalidDocumentOperation(
        `اختر من طبقتين إلى ${MAX_IMAGE_LAYERS} طبقة Raster للدمج.`,
      );
    }
    const selected = uniqueIds.map((id) =>
      document.layers.find((layer) => layer.id === id),
    );
    if (
      selected.some(
        (layer) =>
          !layer ||
          layer.kind !== "raster" ||
          layer.locked ||
          layer.fixed ||
          !layer.visible ||
          !layer.bounds ||
          !layer.rasterAsset,
      )
    ) {
      throw invalidDocumentOperation(
        "يجب أن تكون كل الطبقات المحددة Raster ظاهرة وغير مقفلة ولها أصول وحدود.",
      );
    }
    const rasterLayers = selected as Array<
      LayerNode & {
        bounds: NonNullable<LayerNode["bounds"]>;
        rasterAsset: NonNullable<LayerNode["rasterAsset"]>;
      }
    >;
    if (
      rasterLayers.some(
        (layer) => layer.parentId !== rasterLayers[0]!.parentId,
      )
    ) {
      throw invalidDocumentOperation(
        "لا يمكن دمج طبقات Raster من مجموعات مختلفة.",
      );
    }
    const stored = await Promise.all(
      rasterLayers.map(async (layer) => {
        const object = await this.loadRasterObject(layer.rasterAsset);
        if (!object) {
          throw new ProcessingDomainError(
            "LAYER_ASSET_NOT_FOUND",
            "أحد أصول Raster المحددة غير متاح.",
          );
        }
        return { layer, object };
      }),
    );
    const bounds = unionBounds(rasterLayers.map((layer) => layer.bounds));
    let mergedBody: Buffer;
    try {
      mergedBody = await mergeRasterLayers({
        bounds,
        layers: stored.map(({ layer, object }) => ({
          source: object.body,
          bounds: layer.bounds,
          opacity: layer.opacity,
          zIndex: layer.zIndex,
        })),
      });
    } catch (error) {
      if (error instanceof MediaProcessingError) {
        throw invalidDocumentOperation(error.message);
      }
      throw error;
    }
    const mergedId = crypto.randomUUID();
    const targetRevision = (document.revision ?? 1) + 1;
    const reference = await this.storeToolRaster(
      document,
      targetRevision,
      "merge",
      mergedId,
      mergedBody,
    );
    try {
      const removed = new Set(uniqueIds);
      const mergedLayer: LayerNode = {
        ...rasterLayers[0]!,
        id: mergedId,
        name: normalizeLayerName(`merged_${targetRevision}`),
        visible: true,
        locked: false,
        fixed: false,
        opacity: 1,
        zIndex: Math.max(...rasterLayers.map((layer) => layer.zIndex)),
        confidence: Math.min(
          ...rasterLayers.map((layer) => layer.confidence ?? 1),
        ),
        bounds,
        rasterAsset: reference,
      };
      const layers = [
        ...document.layers.filter((layer) => !removed.has(layer.id)),
        mergedLayer,
      ];
      const changed: LayerDocument = {
        ...document,
        layers,
        imagePreparation: {
          ...document.imagePreparation,
          outputLayers: layers.filter((layer) => layer.kind === "raster").length,
        },
      };
      const details = {
        affectedLayerIds: uniqueIds,
        createdLayerIds: [mergedId],
        removedLayerIds: uniqueIds,
      };
      const updated = await this.saveDocumentOperation(
        document,
        changed,
        "image-merge",
        input.actorUserId,
        input.operationId,
        details,
        "image",
      );
      return { document: updated, ...details };
    } catch (error) {
      await this.storage.delete(reference.objectKey).catch(() => undefined);
      throw error;
    }
  }

  private async requireOperationDocument(
    projectId: string,
    sourceVersionId: string,
    baseRevision: number,
  ): Promise<LayerDocument> {
    const document = await this.findDocument(projectId, sourceVersionId);
    if ((document.revision ?? 1) !== baseRevision) throw revisionConflict();
    return document;
  }

  private async saveDocumentOperation(
    original: LayerDocument,
    changed: LayerDocument,
    kind: LayerEditKind,
    actorUserId: string,
    operationId: string,
    details?: Pick<
      LayerDocumentEditResult,
      "affectedLayerIds" | "createdLayerIds" | "removedLayerIds"
    >,
    projectKind: ProjectKind = "book",
  ): Promise<LayerDocument> {
    const updated = this.withEditTimeline(changed, original, {
      kind,
      actorUserId,
      operationId,
      ...details,
    });
    const issues = validateProductionDocument(updated, projectKind);
    if (issues.length > 0) {
      throw invalidDocumentOperation(
        issues[0]?.message ?? "فشل فحص وثيقة الطبقات بعد التعديل.",
      );
    }
    const saved = await this.documents.saveIfRevision(
      updated,
      original.revision ?? 1,
    );
    if (!saved) throw revisionConflict();
    return updated;
  }

  private withEditTimeline(
    changed: LayerDocument,
    original: LayerDocument,
    operation: {
      kind: LayerEditKind;
      actorUserId: string;
      operationId: string;
      affectedLayerIds?: string[];
      createdLayerIds?: string[];
      removedLayerIds?: string[];
    },
  ): LayerDocument {
    const currentRevision = original.revision ?? 1;
    const timestamp = this.now().toISOString();
    const timeline = original.editTimeline ?? {
      cursor: 0,
      entries: [
        {
          operationId: `baseline:${original.projectId}:${original.sourceVersionId ?? "source"}:${currentRevision}`,
          kind: "baseline" as const,
          revision: currentRevision,
          actorUserId: operation.actorUserId,
          createdAt: original.generatedAt ?? timestamp,
        },
      ],
    };
    const entries = [
      ...timeline.entries.slice(0, timeline.cursor + 1),
      {
        operationId: operation.operationId,
        kind: operation.kind,
        revision: currentRevision + 1,
        actorUserId: operation.actorUserId,
        createdAt: timestamp,
        ...(operation.affectedLayerIds
          ? { affectedLayerIds: operation.affectedLayerIds }
          : {}),
        ...(operation.createdLayerIds
          ? { createdLayerIds: operation.createdLayerIds }
          : {}),
        ...(operation.removedLayerIds
          ? { removedLayerIds: operation.removedLayerIds }
          : {}),
      },
    ].slice(-100);
    return {
      ...changed,
      revision: currentRevision + 1,
      editTimeline: { entries, cursor: entries.length - 1 },
    };
  }

  private async findOperationReplay(
    document: LayerDocument,
    operationId: string,
    kind: LayerEditKind,
  ): Promise<{
    document: LayerDocument;
    entry: NonNullable<LayerDocument["editTimeline"]>["entries"][number];
  } | null> {
    const entry = document.editTimeline?.entries.find(
      (candidate) => candidate.operationId === operationId,
    );
    if (!entry) return null;
    if (entry.kind !== kind) {
      throw invalidDocumentOperation(
        "استُخدم مفتاح العملية نفسه لتعديل مختلف.",
      );
    }
    const replay = await this.documents.findRevision(
      document.projectId,
      document.sourceVersionId!,
      entry.revision,
    );
    return replay ? { document: replay, entry } : null;
  }

  private async storeToolRaster(
    document: LayerDocument,
    revision: number,
    tool: "edge-refine" | "merge",
    layerId: string,
    body: Buffer,
  ): Promise<RasterAssetReference> {
    const objectKey = [
      "derived",
      encodeURIComponent(document.projectId),
      encodeURIComponent(document.sourceVersionId ?? "source"),
      "tools",
      `revision-${revision}`,
      `${tool}-${encodeURIComponent(layerId)}.png`,
    ].join("/");
    const reference: RasterAssetReference = {
      objectKey,
      contentType: "image/png",
      sizeBytes: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
    };
    await this.storage.put({ key: objectKey, ...reference, body });
    return reference;
  }

  private async applyImageStrokes(
    document: LayerDocument,
    strokes: readonly ImageGuidanceStroke[],
    targetRevision: number,
  ): Promise<{
    document: LayerDocument;
    affectedLayerIds: string[];
    createdLayerIds: string[];
    warnings: string[];
    storedKeys: string[];
  }> {
    const byLayer = new Map<string, ImageGuidanceStroke[]>();
    for (const stroke of strokes) {
      if (!stroke.targetLayerId) {
        throw new ProcessingDomainError(
          "GUIDANCE_LAYER_UNAVAILABLE",
          "يجب اختيار طبقة Raster مستهدفة لكل ضربة قلم.",
        );
      }
      const list = byLayer.get(stroke.targetLayerId) ?? [];
      list.push(stroke);
      byLayer.set(stroke.targetLayerId, list);
    }
    const separateTargets = [...byLayer.entries()].filter(([, list]) =>
      list.some((stroke) => stroke.kind === "separate"),
    ).length;
    const contentLayerCount = document.layers.filter(
      (layer) => layer.kind !== "group",
    ).length;
    if (contentLayerCount + separateTargets > MAX_IMAGE_LAYERS) {
      throw new ProcessingDomainError(
        "IMAGE_LAYER_LIMIT_EXCEEDED",
        `لا يمكن أن تتجاوز الصور ${MAX_IMAGE_LAYERS} طبقة.`,
      );
    }

    let layers = [...document.layers];
    const affectedLayerIds: string[] = [];
    const createdLayerIds: string[] = [];
    const warnings: string[] = [];
    const storedKeys: string[] = [];
    for (const [layerId, layerStrokes] of byLayer) {
      const layer = layers.find((candidate) => candidate.id === layerId);
      if (
        !layer ||
        layer.kind !== "raster" ||
        layer.locked ||
        layer.fixed ||
        !layer.rasterAsset
      ) {
        throw new ProcessingDomainError(
          "GUIDANCE_LAYER_UNAVAILABLE",
          "الطبقة المستهدفة غير موجودة أو مقفلة أو لا تحمل أصل Raster.",
        );
      }
      const object = await this.loadRasterObject(layer.rasterAsset);
      if (!object) {
        throw new ProcessingDomainError(
          "LAYER_ASSET_NOT_FOUND",
          "أصل الطبقة المستهدفة غير متاح في التخزين.",
        );
      }
      const applied = await applyRasterGuidance({
        source: object.body,
        documentWidth: document.width,
        documentHeight: document.height,
        ...(layer.bounds ? { layerBounds: layer.bounds } : {}),
        strokes: layerStrokes,
        autoFillPolicy: "review",
      });
      warnings.push(...applied.warnings.map((warning) => `${layerId}:${warning}`));
      affectedLayerIds.push(layerId);
      if (!applied.changed) continue;

      const refinedReference = await this.storeGuidedRaster(
        document,
        targetRevision,
        layerId,
        "refined",
        applied.refined,
      );
      storedKeys.push(refinedReference.objectKey);
      layers = layers.map((candidate) =>
        candidate.id === layerId
          ? { ...candidate, rasterAsset: refinedReference }
          : candidate,
      );
      if (applied.separated) {
        const separatedId = crypto.randomUUID();
        const separatedReference = await this.storeGuidedRaster(
          document,
          targetRevision,
          separatedId,
          "separated",
          applied.separated,
        );
        storedKeys.push(separatedReference.objectKey);
        const currentLayer = layers.find(
          (candidate) => candidate.id === layerId,
        )!;
        layers.push({
          ...currentLayer,
          id: separatedId,
          name: `+separated_${String(
            createdLayerIds.length + 1,
          ).padStart(2, "0")}`,
          locked: false,
          fixed: false,
          zIndex: Math.max(...layers.map((candidate) => candidate.zIndex), 0) + 1,
          confidence: 1,
          rasterAsset: separatedReference,
        });
        createdLayerIds.push(separatedId);
      }
    }
    return {
      document: { ...document, layers },
      affectedLayerIds,
      createdLayerIds,
      warnings,
      storedKeys,
    };
  }

  private async storeGuidedRaster(
    document: LayerDocument,
    revision: number,
    layerId: string,
    role: "refined" | "separated",
    body: Buffer,
  ): Promise<RasterAssetReference> {
    const objectKey = [
      "derived",
      encodeURIComponent(document.projectId),
      encodeURIComponent(document.sourceVersionId ?? "source"),
      "guidance",
      `revision-${revision}`,
      `${encodeURIComponent(layerId)}-${role}.png`,
    ].join("/");
    const reference: RasterAssetReference = {
      objectKey,
      contentType: "image/png",
      sizeBytes: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
    };
    await this.storage.put({ key: objectKey, ...reference, body });
    return reference;
  }

  private async loadRasterObject(
    reference: RasterAssetReference,
  ): Promise<StoredObject | null> {
    let object: StoredObject | null;
    try {
      object = await this.storage.get(reference.objectKey, {
        maxBytes: reference.sizeBytes,
      });
    } catch (error) {
      if (isObjectStorageIntegrityFailure(error)) {
        throw new ProcessingDomainError(
          "LAYER_ASSET_INTEGRITY_FAILED",
          "فشل التحقق من سلامة أصل طبقة Raster المخزن.",
        );
      }
      throw error;
    }
    if (object && !hasExpectedObjectIntegrity(object, reference)) {
      throw new ProcessingDomainError(
        "LAYER_ASSET_INTEGRITY_FAILED",
        "فشل التحقق من سلامة أصل طبقة Raster المخزن.",
      );
    }
    return object;
  }

  private async run(job: ProcessingJob): Promise<ProcessingJob> {
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
              ...(this.pdfOcrEngine
                ? { ocrEngine: this.pdfOcrEngine }
                : {}),
            });
        }
      } else {
        const prepared = await prepareImageSource({
          projectId: job.projectId,
          sourceVersionId: job.sourceVersionId,
          source: source.body,
        });
        storedRasterAssetKeys = await this.storeRasterAssets(
          prepared.rasterAssets,
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
        if (!saved) throw revisionConflict();
      }
      documentSaved = true;
      return this.transition(verifying, "ready", 100);
    } catch (error) {
      if (!documentSaved && storedRasterAssetKeys.length > 0) {
        await Promise.allSettled(
          storedRasterAssetKeys.map((key) => this.storage.delete(key)),
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

  private async storeRasterAssets(
    assets: readonly PreparedRasterAsset[],
  ): Promise<string[]> {
    const stored: string[] = [];
    try {
      for (const asset of assets) {
        await this.storage.put({
          key: asset.objectKey,
          contentType: asset.contentType,
          sizeBytes: asset.sizeBytes,
          body: asset.body,
        });
        stored.push(asset.objectKey);
      }
      return stored;
    } catch (error) {
      await Promise.allSettled(
        stored.map((key) => this.storage.delete(key)),
      );
      throw error;
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
    throw new ProcessingDomainError(toDomainCode(code), message, job.id);
  }
}

function isValidLayerName(name: string): name is `+${string}` {
  return (
    name.length >= 2 &&
    name.length <= 121 &&
    name.startsWith("+") &&
    !name.startsWith("++") &&
    !/[\u0000-\u001F\u007F\\/]/u.test(name)
  );
}

function invalidDocumentOperation(message: string): ProcessingDomainError {
  return new ProcessingDomainError("INVALID_DOCUMENT_OPERATION", message);
}

function revisionConflict(): ProcessingDomainError {
  return new ProcessingDomainError(
    "DOCUMENT_REVISION_CONFLICT",
    "تغيرت وثيقة الطبقات منذ بدء العملية. أعد تحميلها ثم حاول مجددًا.",
  );
}

function compareTextLayers(left: LayerNode, right: LayerNode): number {
  const order =
    (left.readingOrder ?? Number.MAX_SAFE_INTEGER) -
    (right.readingOrder ?? Number.MAX_SAFE_INTEGER);
  if (order !== 0) return order;
  const vertical = (left.bounds?.y ?? 0) - (right.bounds?.y ?? 0);
  if (Math.abs(vertical) > 1) return vertical;
  return left.direction === "rtl"
    ? (right.bounds?.x ?? 0) - (left.bounds?.x ?? 0)
    : (left.bounds?.x ?? 0) - (right.bounds?.x ?? 0);
}

function normalizePageReadingOrder(
  layers: readonly LayerNode[],
  pageNumber: number,
): LayerNode[] {
  const orderedIds = new Map(
    layers
      .filter(
        (layer) =>
          layer.kind === "text" && layer.pageNumber === pageNumber,
      )
      .sort(compareTextLayers)
      .map((layer, index) => [layer.id, index]),
  );
  return layers.map((layer) => {
    const readingOrder = orderedIds.get(layer.id);
    return readingOrder === undefined ? layer : { ...layer, readingOrder };
  });
}

function unionBounds(bounds: readonly NonNullable<LayerNode["bounds"]>[]) {
  const left = Math.min(...bounds.map((value) => value.x));
  const top = Math.min(...bounds.map((value) => value.y));
  const right = Math.max(...bounds.map((value) => value.x + value.width));
  const bottom = Math.max(...bounds.map((value) => value.y + value.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function editReplayResult(replay: {
  document: LayerDocument;
  entry: NonNullable<LayerDocument["editTimeline"]>["entries"][number];
}): LayerDocumentEditResult {
  return {
    document: replay.document,
    affectedLayerIds: replay.entry.affectedLayerIds ?? [],
    createdLayerIds: replay.entry.createdLayerIds ?? [],
    removedLayerIds: replay.entry.removedLayerIds ?? [],
  };
}

function toDomainCode(code: string): ProcessingDomainErrorCode {
  switch (code) {
    case "SOURCE_NOT_READY":
    case "SOURCE_INTEGRITY_FAILED":
    case "OCR_REQUIRED":
    case "OCR_FAILED":
    case "PDF_DECODE_FAILED":
    case "PDF_TOO_MANY_PAGES":
    case "PDF_TEXT_LIMIT_EXCEEDED":
    case "IMAGE_HAS_NO_VISIBLE_PIXELS":
    case "DOCUMENT_REVISION_CONFLICT":
    case "INVALID_DOCUMENT_OPERATION":
      return code;
    default:
      return "PROCESSING_FAILED";
  }
}
