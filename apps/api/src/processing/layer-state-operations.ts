import {
  MAX_LAYER_TEXT_CHARACTERS,
  type LayerDocument,
  type LayerStateUpdate,
  type ProjectKind,
} from "@motionprep/contracts";
import { validateProductionDocument } from "@motionprep/presets";
import {
  DocumentEditCoordinator,
  layerEditRequestHash,
} from "./document-edit-coordinator.js";
import { ProcessingDomainError } from "./processing-errors.js";
import type { LayerDocumentRepository } from "./processing-repository.js";

export interface UpdateLayerStatesInput {
  projectId: string;
  sourceVersionId: string;
  projectKind: ProjectKind;
  baseRevision: number;
  updates: readonly LayerStateUpdate[];
  actorUserId: string;
  operationId: string;
}

export class LayerStateOperations {
  constructor(
    private readonly edits: DocumentEditCoordinator,
    private readonly documents: LayerDocumentRepository,
  ) {}

  async update(input: UpdateLayerStatesInput): Promise<LayerDocument> {
    const document = await this.edits.requireDocument(
      input.projectId,
      input.sourceVersionId,
    );
    const requestHash = layerEditRequestHash("layer-state", input);
    const replay = await this.edits.findReplay(
      document,
      input.operationId,
      "layer-state",
      requestHash,
    );
    if (replay) return replay.document;
    const currentRevision = document.revision ?? 1;
    if (currentRevision !== input.baseRevision) {
      throw new ProcessingDomainError(
        "DOCUMENT_REVISION_CONFLICT",
        "تغيرت وثيقة الطبقات منذ فتح المراجعة. أعد تحميلها قبل الحفظ.",
      );
    }

    const updatesById = validateUpdates(input.updates);
    const layersById = new Map(
      document.layers.map((layer) => [layer.id, layer]),
    );
    if ([...updatesById.keys()].some((id) => !layersById.has(id))) {
      throw invalidLayerUpdate(
        "تتضمن المراجعة طبقة لا تنتمي إلى وثيقة المصدر الحالية.",
      );
    }
    for (const change of updatesById.values()) {
      const current = layersById.get(change.id);
      const textChanged =
        change.fullText !== undefined && change.fullText !== current?.fullText;
      if (textChanged && current?.kind !== "text") {
        throw invalidLayerUpdate("لا يمكن إضافة محتوى نصي إلى طبقة غير نصية.");
      }
      if (current?.locked && lockedLayerContentChanged(change, current)) {
        throw invalidLayerUpdate(
          "افتح قفل الطبقة قبل تعديل محتواها أو خصائصها أو ترتيبها.",
        );
      }
      if (
        current?.fixed &&
        (change.name !== current.name ||
          change.visible !== current.visible ||
          change.locked !== current.locked ||
          change.opacity !== current.opacity ||
          change.zIndex !== current.zIndex ||
          change.readingOrder !== current.readingOrder ||
          metadataChanged(change, current))
      ) {
        throw invalidLayerUpdate(
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
              ...(change.bounds === undefined ? {} : { bounds: change.bounds }),
              ...(change.direction === undefined
                ? {}
                : { direction: change.direction }),
              ...(change.textAlign === undefined
                ? {}
                : { textAlign: change.textAlign }),
              ...(change.fontFamily === undefined
                ? {}
                : { fontFamily: change.fontFamily }),
              ...(change.fontSize === undefined
                ? {}
                : { fontSize: change.fontSize }),
              ...(change.fullText === undefined
                ? {}
                : { fullText: change.fullText }),
            }
          : layer;
      }),
    };
    const updated = this.edits.withTimeline(changed, document, {
      kind: "layer-state",
      actorUserId: input.actorUserId,
      operationId: input.operationId,
      requestHash,
    });
    const issues = validateProductionDocument(updated, input.projectKind);
    if (issues.length > 0) {
      throw invalidLayerUpdate(
        issues[0]?.message ?? "فشل فحص وثيقة الطبقات بعد التعديل.",
      );
    }
    const saved = await this.documents.saveIfRevision(updated, currentRevision);
    if (!saved) {
      throw new ProcessingDomainError(
        "DOCUMENT_REVISION_CONFLICT",
        "تغيرت وثيقة الطبقات أثناء الحفظ. أعد تحميلها ثم حاول مجددًا.",
      );
    }
    return updated;
  }
}

function validateUpdates(
  updates: readonly LayerStateUpdate[],
): Map<string, LayerStateUpdate> {
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
          update.readingOrder > 1_000_000)) ||
      (update.bounds !== undefined && !validBounds(update.bounds)) ||
      (update.direction !== undefined &&
        update.direction !== "ltr" &&
        update.direction !== "rtl") ||
      (update.textAlign !== undefined &&
        update.textAlign !== "start" &&
        update.textAlign !== "center" &&
        update.textAlign !== "end" &&
        update.textAlign !== "justify") ||
      (update.fontFamily !== undefined &&
        (update.fontFamily.trim().length === 0 ||
          update.fontFamily.length > 120 ||
          /[\u0000-\u001F\u007F]/u.test(update.fontFamily))) ||
      (update.fontSize !== undefined &&
        (!Number.isFinite(update.fontSize) ||
          update.fontSize < 1 ||
          update.fontSize > 500)) ||
      (update.fullText !== undefined && !validFullText(update.fullText))
    ) {
      throw invalidLayerUpdate("تحديثات الطبقات غير صالحة.");
    }
    updatesById.set(
      update.id,
      update.fullText === undefined
        ? update
        : { ...update, fullText: update.fullText.trim() },
    );
  }
  return updatesById;
}

function validBounds(bounds: NonNullable<LayerStateUpdate["bounds"]>): boolean {
  return (
    [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) &&
    bounds.x >= 0 &&
    bounds.y >= 0 &&
    bounds.width > 0 &&
    bounds.height > 0 &&
    [bounds.x, bounds.y, bounds.width, bounds.height].every(
      (value) => value <= 1_000_000,
    )
  );
}

function validFullText(value: string): boolean {
  return (
    value.trim().length > 0 &&
    Array.from(value).length <= MAX_LAYER_TEXT_CHARACTERS &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)
  );
}

function metadataChanged(
  change: LayerStateUpdate,
  current: LayerDocument["layers"][number],
): boolean {
  return (
    (change.bounds !== undefined &&
      JSON.stringify(change.bounds) !== JSON.stringify(current.bounds)) ||
    (change.direction !== undefined && change.direction !== current.direction) ||
    (change.textAlign !== undefined &&
      change.textAlign !== current.textAlign) ||
    (change.fontFamily !== undefined &&
      change.fontFamily !== current.fontFamily) ||
    (change.fontSize !== undefined && change.fontSize !== current.fontSize) ||
    (change.fullText !== undefined && change.fullText !== current.fullText)
  );
}

function lockedLayerContentChanged(
  change: LayerStateUpdate,
  current: LayerDocument["layers"][number],
): boolean {
  return (
    change.name !== current.name ||
    change.opacity !== current.opacity ||
    change.zIndex !== current.zIndex ||
    (change.readingOrder !== undefined &&
      change.readingOrder !== current.readingOrder) ||
    metadataChanged(change, current)
  );
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

function invalidLayerUpdate(message: string): ProcessingDomainError {
  return new ProcessingDomainError("INVALID_LAYER_UPDATE", message);
}
