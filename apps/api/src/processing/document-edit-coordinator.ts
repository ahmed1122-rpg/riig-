import type {
  LayerDocument,
  LayerDocumentEditResult,
  LayerEditKind,
  ProjectKind,
} from "@motionprep/contracts";
import { validateProductionDocument } from "@motionprep/presets";
import { ProcessingDomainError } from "./processing-errors.js";
import type { LayerDocumentRepository } from "./processing-repository.js";

type EditDetails = Pick<
  LayerDocumentEditResult,
  "affectedLayerIds" | "createdLayerIds" | "removedLayerIds"
>;

export interface OperationReplay {
  document: LayerDocument;
  entry: NonNullable<LayerDocument["editTimeline"]>["entries"][number];
}

export class DocumentEditCoordinator {
  constructor(
    private readonly documents: LayerDocumentRepository,
    private readonly now: () => Date,
  ) {}

  async requireDocument(
    projectId: string,
    sourceVersionId: string,
    baseRevision?: number,
  ): Promise<LayerDocument> {
    const document = await this.documents.findBySource(
      projectId,
      sourceVersionId,
    );
    if (!document) {
      throw new ProcessingDomainError(
        "DOCUMENT_NOT_FOUND",
        "وثيقة الطبقات غير موجودة أو لم تكتمل معالجتها.",
      );
    }
    if (
      baseRevision !== undefined &&
      (document.revision ?? 1) !== baseRevision
    ) {
      throw revisionConflict();
    }
    return document;
  }

  async save(
    original: LayerDocument,
    changed: LayerDocument,
    kind: LayerEditKind,
    actorUserId: string,
    operationId: string,
    details?: EditDetails,
    projectKind: ProjectKind = "book",
  ): Promise<LayerDocument> {
    const updated = this.withTimeline(changed, original, {
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

  withTimeline(
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

  async findReplay(
    document: LayerDocument,
    operationId: string,
    kind: LayerEditKind,
  ): Promise<OperationReplay | null> {
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
}

export function invalidDocumentOperation(
  message: string,
): ProcessingDomainError {
  return new ProcessingDomainError("INVALID_DOCUMENT_OPERATION", message);
}

export function revisionConflict(): ProcessingDomainError {
  return new ProcessingDomainError(
    "DOCUMENT_REVISION_CONFLICT",
    "تغيرت وثيقة الطبقات منذ بدء العملية. أعد تحميلها ثم حاول مجددًا.",
  );
}

export function editReplayResult(
  replay: OperationReplay,
): LayerDocumentEditResult {
  return {
    document: replay.document,
    affectedLayerIds: replay.entry.affectedLayerIds ?? [],
    createdLayerIds: replay.entry.createdLayerIds ?? [],
    removedLayerIds: replay.entry.removedLayerIds ?? [],
  };
}
