import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { LayerDocumentCommand } from "@motionprep/contracts";
import type { Layer } from "../../types";
import {
  mergeImageLayers,
  mergePdfTextLayers,
  refineImageLayerEdges,
  runLayerDocumentCommand,
  runPdfRegionOcr,
  splitPdfTextLayer,
  type LayerDocumentView,
} from "../../lib/api";
import type {
  ImageRasterOperation,
  PdfTextOperation,
} from "./useWorkspaceToolController";
import type {
  DocumentCommandContext,
  DocumentCommandCoordinator,
} from "./useDocumentCommandCoordinator";
import type { RecordDocumentChange } from "./documentChangeSummary";
import {
  workspaceCommandError,
  type WorkspaceCommandStatus,
} from "./workspaceCommandStatus";

type SetState<Value> = Dispatch<SetStateAction<Value>>;

type PdfTextInput =
  | { operation: "split"; offset: number }
  | { operation: "merge"; separator: "space" | "newline" };

type ImageRasterInput =
  | { operation: "edge-refine"; radius: 1 | 2 | 3; strength: number }
  | { operation: "merge" };

interface WorkspaceLayerMutationOptions {
  projectId?: string;
  sourceVersionId?: string;
  pdfTextOperation: PdfTextOperation | undefined;
  imageRasterOperation: ImageRasterOperation | undefined;
  pdfRegionOcrLayer: Layer | undefined;
  pdfRegionOcrPageSize: { width: number; height: number } | undefined;
  layers: readonly Layer[];
  onDocumentChanged: RecordDocumentChange;
  commandCoordinator: DocumentCommandCoordinator;
  adoptDocument: (
    document: LayerDocumentView,
    preferredLayerId?: string,
  ) => Promise<void>;
  setProcessing: SetState<boolean>;
  setCommandStatus: SetState<WorkspaceCommandStatus>;
  onNotify: (message: string) => void;
}

function requireSource(
  projectId?: string,
  sourceVersionId?: string,
): { projectId: string; sourceVersionId: string } {
  if (!projectId || !sourceVersionId) {
    throw new Error("ارفع مصدرًا وجهّزه قبل تعديل الطبقات.");
  }
  return { projectId, sourceVersionId };
}

export function useWorkspaceLayerMutations(
  options: WorkspaceLayerMutationOptions,
) {
  const runMutation = useCallback(
    async (
      label: string,
      mutation: (context: DocumentCommandContext) => Promise<void>,
    ) => {
      options.setProcessing(true);
      options.setCommandStatus({ phase: "running", label });
      try {
        await options.commandCoordinator.run(mutation);
        options.setCommandStatus({ phase: "idle" });
      } catch (error) {
        options.setCommandStatus(
          workspaceCommandError(label, error, "تعذر تنفيذ أمر الطبقات."),
        );
        throw error;
      } finally {
        options.setProcessing(false);
      }
    },
    [
      options.setProcessing,
      options.setCommandStatus,
      options.commandCoordinator,
    ],
  );

  const applyPdfTextOperation = useCallback(
    async (input: PdfTextInput) => {
      const source = requireSource(
        options.projectId,
        options.sourceVersionId,
      );
      const operation = options.pdfTextOperation;
      if (!operation) throw new Error("لم تعد العملية النصية متاحة.");
      await runMutation(
        input.operation === "split" ? "تقسيم نص PDF" : "دمج نصوص PDF",
        async ({ baseRevision, signal }) => {
        const before = options.layers;
        const revision = requireRevision(baseRevision);
        const result =
          input.operation === "split"
            ? await splitPdfTextLayer(source.projectId, {
                sourceVersionId: source.sourceVersionId,
                baseRevision: revision,
                layerId: operation.layerIds[0]!,
                offset: input.offset,
              }, signal)
            : await mergePdfTextLayers(source.projectId, {
                sourceVersionId: source.sourceVersionId,
                baseRevision: revision,
                layerIds: operation.layerIds,
                separator: input.separator,
              }, signal);
        const preferredLayerId =
          result.createdLayerIds[0] ??
          result.affectedLayerIds.find((id) =>
            result.document.layers.some((layer) => layer.id === id),
          );
        options.onDocumentChanged(
          input.operation === "split" ? "تقسيم نص PDF" : "دمج نصوص PDF",
          before,
          result.document,
        );
        await options.adoptDocument(result.document, preferredLayerId);
        options.onNotify(
          input.operation === "split"
            ? "تم تقسيم الوحدة النصية وحفظ مراجعة قابلة للتراجع."
            : "تم دمج الوحدات النصية وحفظ مراجعة قابلة للتراجع.",
        );
        },
      );
    },
    [
      options.adoptDocument,
      options.onNotify,
      options.layers,
      options.onDocumentChanged,
      options.pdfTextOperation,
      options.projectId,
      options.sourceVersionId,
      runMutation,
    ],
  );

  const applyPdfRegionOcr = useCallback(
    async (paddingPercent: number) => {
      const source = requireSource(
        options.projectId,
        options.sourceVersionId,
      );
      const layer = options.pdfRegionOcrLayer;
      const pageSize = options.pdfRegionOcrPageSize;
      if (!layer?.bounds || layer.pageNumber === undefined || !pageSize) {
        throw new Error("تعذر تحديد منطقة OCR أو أبعاد صفحتها.");
      }
      const paddingRatio = paddingPercent / 100;
      const paddingX = layer.bounds.width * paddingRatio;
      const paddingY = layer.bounds.height * paddingRatio;
      const start = {
        x: Math.max(0, layer.bounds.x - paddingX) / pageSize.width,
        y: Math.max(0, layer.bounds.y - paddingY) / pageSize.height,
      };
      const end = {
        x:
          Math.min(
            pageSize.width,
            layer.bounds.x + layer.bounds.width + paddingX,
          ) / pageSize.width,
        y:
          Math.min(
            pageSize.height,
            layer.bounds.y + layer.bounds.height + paddingY,
          ) / pageSize.height,
      };
      await runMutation("OCR إقليمي", async ({ baseRevision, signal }) => {
        const before = options.layers;
        const document = await runPdfRegionOcr(
          source.projectId,
          {
            sourceVersionId: source.sourceVersionId,
            baseRevision: requireRevision(baseRevision),
            pageNumber: layer.pageNumber!,
            start,
            end,
          },
          {
            signal,
            onProgress: (progress) =>
              options.setCommandStatus((current) =>
                current.phase === "running"
                  ? { ...current, progress }
                  : current,
              ),
          },
        );
        options.onDocumentChanged("OCR إقليمي", before, document);
        await options.adoptDocument(document);
        options.onNotify(
          "اكتمل OCR الإقليمي وحُفظ النص الجديد كمراجعة قابلة للتراجع.",
        );
      });
    },
    [
      options.adoptDocument,
      options.onNotify,
      options.layers,
      options.onDocumentChanged,
      options.pdfRegionOcrLayer,
      options.pdfRegionOcrPageSize,
      options.projectId,
      options.setCommandStatus,
      options.sourceVersionId,
      runMutation,
    ],
  );

  const applyImageRasterOperation = useCallback(
    async (input: ImageRasterInput) => {
      const source = requireSource(
        options.projectId,
        options.sourceVersionId,
      );
      const operation = options.imageRasterOperation;
      if (!operation) throw new Error("لم تعد عملية Raster متاحة.");
      await runMutation(
        input.operation === "edge-refine"
          ? "تحسين حواف Raster"
          : "دمج طبقات Raster",
        async ({ baseRevision, signal }) => {
        const before = options.layers;
        const revision = requireRevision(baseRevision);
        const result =
          input.operation === "edge-refine"
            ? await refineImageLayerEdges(source.projectId, {
                sourceVersionId: source.sourceVersionId,
                baseRevision: revision,
                layerId: operation.layerIds[0]!,
                radius: input.radius,
                strength: input.strength,
              }, signal)
            : await mergeImageLayers(source.projectId, {
                sourceVersionId: source.sourceVersionId,
                baseRevision: revision,
                layerIds: operation.layerIds,
              }, signal);
        options.onDocumentChanged(
          input.operation === "edge-refine"
            ? "تحسين حواف Raster"
            : "دمج طبقات Raster",
          before,
          result.document,
        );
        await options.adoptDocument(
          result.document,
          result.createdLayerIds[0] ?? result.affectedLayerIds[0],
        );
        options.onNotify(
          input.operation === "edge-refine"
            ? "تم تحسين الحواف وحفظ أصل Raster جديد قابل للتراجع."
            : "تم دمج طبقات Raster وحفظ الناتج كمراجعة قابلة للتراجع.",
        );
        },
      );
    },
    [
      options.adoptDocument,
      options.imageRasterOperation,
      options.layers,
      options.onNotify,
      options.onDocumentChanged,
      options.projectId,
      options.sourceVersionId,
      runMutation,
    ],
  );

  const applyLayerCommand = useCallback(
    async (command: LayerDocumentCommand): Promise<void> => {
      const source = requireSource(options.projectId, options.sourceVersionId);
      await runMutation(layerCommandChangeLabel(command), async ({ baseRevision, signal }) => {
        const before = options.layers;
        const document = await runLayerDocumentCommand(
          source.projectId,
          source.sourceVersionId,
          requireRevision(baseRevision),
          command,
          undefined,
          signal,
        );
        options.onDocumentChanged(layerCommandChangeLabel(command), before, document);
        await options.adoptDocument(document);
        options.onNotify("تم تنفيذ أمر الطبقات وحفظه كعملية ذرّية واحدة.");
      });
    },
    [
      options.adoptDocument,
      options.layers,
      options.onNotify,
      options.onDocumentChanged,
      options.projectId,
      options.sourceVersionId,
      runMutation,
    ],
  );

  return {
    applyLayerCommand,
    applyImageRasterOperation,
    applyPdfRegionOcr,
    applyPdfTextOperation,
  };
}

function requireRevision(revision: number | undefined): number {
  if (revision === undefined) {
    throw new Error("وثيقة الطبقات غير جاهزة لتنفيذ الأمر.");
  }
  return revision;
}

function layerCommandChangeLabel(command: LayerDocumentCommand): string {
  if (command.kind === "normalize-names") return "توحيد أسماء الطبقات";
  if (command.kind === "move-layer") return "تحريك طبقة";
  if (command.kind === "update-state") return "تحديث حالة طبقات";
  return command.order === "reading" ? "ترتيب القراءة" : "عكس الترتيب";
}
