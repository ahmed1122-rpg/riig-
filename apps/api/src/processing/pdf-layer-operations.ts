import type {
  LayerDocument,
  LayerDocumentEditResult,
} from "@motionprep/contracts";
import {
  DocumentEditCoordinator,
  layerEditRequestHash,
  revisionConflict,
} from "./document-edit-coordinator.js";
import {
  preparePdfTextMerge,
  preparePdfTextSplit,
} from "./pdf-text-operations.js";
import { ProcessingDomainError } from "./processing-errors.js";
import type { LayerDocumentRepository } from "./processing-repository.js";

export interface SplitPdfTextLayerInput {
  projectId: string;
  sourceVersionId: string;
  baseRevision: number;
  layerId: string;
  offset: number;
  actorUserId: string;
  operationId: string;
}

export interface MergePdfTextLayersInput {
  projectId: string;
  sourceVersionId: string;
  baseRevision: number;
  layerIds: readonly string[];
  separator: "space" | "newline";
  actorUserId: string;
  operationId: string;
}

export interface NavigateEditHistoryInput {
  projectId: string;
  sourceVersionId: string;
  baseRevision: number;
  direction: "undo" | "redo";
  actorUserId: string;
  operationId: string;
}

export class PdfLayerOperations {
  constructor(
    private readonly edits: DocumentEditCoordinator,
    private readonly documents: LayerDocumentRepository,
  ) {}

  async split(
    input: SplitPdfTextLayerInput,
  ): Promise<LayerDocumentEditResult> {
    const document = await this.edits.requireDocument(
      input.projectId,
      input.sourceVersionId,
    );
    const requestHash = layerEditRequestHash("pdf-split", input);
    const replay = await this.edits.findReplay(
      document,
      input.operationId,
      "pdf-split",
      requestHash,
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
    const prepared = preparePdfTextSplit(document, input);
    const updated = await this.edits.save(
      document,
      prepared.changed,
      "pdf-split",
      input.actorUserId,
      input.operationId,
      prepared.details,
      "book",
      requestHash,
    );
    return { document: updated, ...prepared.details };
  }

  async merge(
    input: MergePdfTextLayersInput,
  ): Promise<LayerDocumentEditResult> {
    const document = await this.edits.requireDocument(
      input.projectId,
      input.sourceVersionId,
    );
    const requestHash = layerEditRequestHash("pdf-merge", input);
    const replay = await this.edits.findReplay(
      document,
      input.operationId,
      "pdf-merge",
      requestHash,
    );
    if (replay) {
      return {
        document: replay.document,
        affectedLayerIds: replay.entry.affectedLayerIds ?? [...input.layerIds],
        createdLayerIds: replay.entry.createdLayerIds ?? [],
        removedLayerIds: replay.entry.removedLayerIds ?? input.layerIds.slice(1),
      };
    }
    if ((document.revision ?? 1) !== input.baseRevision) {
      throw revisionConflict();
    }
    const prepared = preparePdfTextMerge(document, input);
    const updated = await this.edits.save(
      document,
      prepared.changed,
      "pdf-merge",
      input.actorUserId,
      input.operationId,
      prepared.details,
      "book",
      requestHash,
    );
    return { document: updated, ...prepared.details };
  }

  async navigate(input: NavigateEditHistoryInput): Promise<LayerDocument> {
    const document = await this.edits.requireDocument(
      input.projectId,
      input.sourceVersionId,
    );
    const requestHash = layerEditRequestHash("history-navigation", input);
    const replay = await this.edits.findHistoryReplay(
      document,
      input.operationId,
      requestHash,
    );
    if (replay) return replay;
    if ((document.revision ?? 1) !== input.baseRevision) {
      throw revisionConflict();
    }
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
    return this.edits.saveHistoryNavigation(document, snapshot, {
      cursor: targetCursor,
      direction: input.direction,
      actorUserId: input.actorUserId,
      operationId: input.operationId,
      requestHash,
    });
  }
}
