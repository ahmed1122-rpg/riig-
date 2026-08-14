import type {
  LayerDocument,
  LayerDocumentCommand,
  ProjectKind,
} from "@motionprep/contracts";
import { applyLayerDocumentCommand } from "@motionprep/layer-domain";
import {
  DocumentEditCoordinator,
  layerEditRequestHash,
} from "./document-edit-coordinator.js";
import { ProcessingDomainError } from "./processing-errors.js";

export interface ApplyLayerCommandInput {
  projectId: string;
  sourceVersionId: string;
  projectKind: ProjectKind;
  baseRevision: number;
  command: LayerDocumentCommand;
  actorUserId: string;
  operationId: string;
}

export class LayerCommandOperations {
  constructor(private readonly edits: DocumentEditCoordinator) {}

  async apply(input: ApplyLayerCommandInput): Promise<LayerDocument> {
    const document = await this.edits.requireDocument(
      input.projectId,
      input.sourceVersionId,
    );
    const requestHash = layerEditRequestHash("layer-command", input);
    const replay = await this.edits.findReplay(
      document,
      input.operationId,
      "layer-command",
      requestHash,
    );
    if (replay) return replay.document;
    if ((document.revision ?? 1) !== input.baseRevision) {
      throw new ProcessingDomainError(
        "DOCUMENT_REVISION_CONFLICT",
        "تغيّرت وثيقة الطبقات. أعد تحميلها قبل تنفيذ الأمر.",
      );
    }
    assertKnownScope(document, input.command);
    let applied;
    try {
      applied = applyLayerDocumentCommand(document, input.command);
    } catch (error) {
      if (error instanceof RangeError) {
        throw new ProcessingDomainError("INVALID_DOCUMENT_OPERATION", error.message);
      }
      throw error;
    }
    return this.edits.save(
      document,
      applied.document,
      "layer-command",
      input.actorUserId,
      input.operationId,
      {
        affectedLayerIds: applied.affectedLayerIds,
        createdLayerIds: [],
        removedLayerIds: [],
      },
      input.projectKind,
      requestHash,
    );
  }
}

function assertKnownScope(
  document: LayerDocument,
  command: LayerDocumentCommand,
): void {
  if (command.kind === "move-layer") {
    const knownIds = new Set(document.layers.map((layer) => layer.id));
    if (!knownIds.has(command.layerId) || !knownIds.has(command.targetLayerId)) {
      throw new ProcessingDomainError(
        "INVALID_DOCUMENT_OPERATION",
        "يتضمن أمر النقل طبقة لا تنتمي إلى وثيقة المصدر الحالية.",
      );
    }
    return;
  }
  const scope = command.scope;
  if (scope.kind !== "layers") return;
  const knownIds = new Set(document.layers.map((layer) => layer.id));
  if (
    new Set(scope.layerIds).size !== scope.layerIds.length ||
    scope.layerIds.some((id) => !knownIds.has(id))
  ) {
    throw new ProcessingDomainError(
      "INVALID_DOCUMENT_OPERATION",
      "يتضمن نطاق الأمر طبقات مكررة أو لا تنتمي إلى وثيقة المصدر الحالية.",
    );
  }
}
