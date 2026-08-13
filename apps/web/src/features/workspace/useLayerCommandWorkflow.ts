import { useRef, useState } from "react";
import type {
  LayerCommandScope,
  LayerDocumentCommand,
} from "@motionprep/contracts";
import { normalizeDocumentLayerNames } from "@motionprep/layer-domain";
import type { Layer, ProjectMode } from "../../types";
import { toDomainLayer } from "./workspaceLayerDomain";

interface LayerNameDiff {
  id: string;
  before: string;
  after: string;
}

export interface LayerCommandLogEntry {
  id: number;
  label: string;
  status: "running" | "succeeded" | "failed";
}

export interface LayerNormalizePreview {
  scope: LayerCommandScope;
  affectedCount: number;
  changes: LayerNameDiff[];
  exceedsLimit: boolean;
}

export function useLayerCommandWorkflow(input: {
  mode: ProjectMode;
  activePdfPage: number;
  layers: readonly Layer[];
  selectedIds: readonly string[];
  onLayerCommand: (command: LayerDocumentCommand) => Promise<void>;
  onNotify: (message: string) => void;
}) {
  const [normalizePreview, setNormalizePreview] =
    useState<LayerNormalizePreview>();
  const [commandLog, setCommandLog] = useState<LayerCommandLogEntry[]>([]);
  const nextLogId = useRef(1);

  const executeCommand = (command: LayerDocumentCommand) => {
    const id = nextLogId.current++;
    setCommandLog((current) => [
      { id, label: commandLabel(command), status: "running" as const },
      ...current,
    ].slice(0, 8));
    void input.onLayerCommand(command).then(
      () => {
        setCommandLog((current) => current.map((entry) =>
          entry.id === id ? { ...entry, status: "succeeded" as const } : entry));
      },
      (error: unknown) => {
        setCommandLog((current) => current.map((entry) =>
          entry.id === id ? { ...entry, status: "failed" as const } : entry));
        input.onNotify(
          error instanceof Error
            ? error.message
            : "تعذر تنفيذ أمر الطبقات. أعد مزامنة الوثيقة ثم حاول مجددًا.",
        );
      },
    );
  };

  const requestNormalize = () => {
    setNormalizePreview(createLayerNormalizePreview(input));
  };

  const confirmNormalize = () => {
    if (!normalizePreview || normalizePreview.exceedsLimit) return;
    executeCommand({ kind: "normalize-names", scope: normalizePreview.scope });
    setNormalizePreview(undefined);
  };

  return {
    commandLog,
    normalizePreview,
    executeCommand,
    requestNormalize,
    confirmNormalize,
    closeNormalizePreview: () => setNormalizePreview(undefined),
  };
}

export function createLayerNormalizePreview(input: {
  mode: ProjectMode;
  activePdfPage: number;
  layers: readonly Layer[];
  selectedIds: readonly string[];
}): LayerNormalizePreview {
  const scope: LayerCommandScope = input.selectedIds.length > 1
    ? { kind: "layers", layerIds: [...input.selectedIds] }
    : input.mode === "book"
      ? { kind: "page", pageNumber: input.activePdfPage }
      : { kind: "document" };
  const scopedIds = resolveScope(input.layers, scope);
  const result = normalizeDocumentLayerNames(
    {
      schemaVersion: "1.0",
      projectId: "workspace-name-preview",
      width: 1,
      height: 1,
      colorSpace: "sRGB",
      layers: input.layers.map(toDomainLayer),
    },
    scopedIds,
  );
  const afterById = new Map(result.document.layers.map((layer) => [layer.id, layer.name]));
  return {
    scope,
    affectedCount: scopedIds.size,
    exceedsLimit: scopedIds.size > 5_000,
    changes: input.layers.flatMap((layer): LayerNameDiff[] => {
      const after = afterById.get(layer.id);
      return after && after !== layer.name
        ? [{ id: layer.id, before: layer.name, after }]
        : [];
    }),
  };
}

function resolveScope(
  layers: readonly Layer[],
  scope: LayerCommandScope,
): Set<string> {
  if (scope.kind === "document") return new Set(layers.map(({ id }) => id));
  if (scope.kind === "page") {
    return new Set(layers.filter((layer) => (layer.pageNumber ?? 1) === scope.pageNumber).map(({ id }) => id));
  }
  if (scope.kind === "parent") {
    return new Set(layers.filter((layer) => (layer.parentId ?? null) === scope.parentId).map(({ id }) => id));
  }
  return new Set(scope.layerIds);
}

function commandLabel(command: LayerDocumentCommand): string {
  if (command.kind === "normalize-names") return "توحيد أسماء الطبقات";
  if (command.kind === "move-layer") return "تحريك طبقة";
  if (command.kind === "update-state") return "تحديث حالة طبقات";
  return command.order === "reading" ? "ترتيب القراءة" : "عكس الترتيب";
}
