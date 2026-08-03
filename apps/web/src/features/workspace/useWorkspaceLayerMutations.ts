import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Layer } from "../../types";
import {
  mergeImageLayers,
  mergePdfTextLayers,
  refineImageLayerEdges,
  runPdfRegionOcr,
  splitPdfTextLayer,
  type LayerDocumentView,
} from "../../lib/api";
import type { UploadState } from "./SourceUploadStatus";
import type {
  ImageRasterOperation,
  PdfTextOperation,
} from "./useWorkspaceToolController";

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
  flushLayerReview: () => Promise<number>;
  adoptDocument: (
    document: LayerDocumentView,
    preferredLayerId?: string,
  ) => Promise<void>;
  setProcessing: SetState<boolean>;
  setUploadState: SetState<UploadState>;
  setUploadProgress: SetState<number>;
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
    async (mutation: () => Promise<void>) => {
      options.setProcessing(true);
      options.setUploadState("verifying");
      options.setUploadProgress(0);
      try {
        await mutation();
        options.setUploadState("ready");
        options.setUploadProgress(100);
      } catch (error) {
        options.setUploadState("ready");
        options.setUploadProgress(100);
        throw error;
      } finally {
        options.setProcessing(false);
      }
    },
    [
      options.setProcessing,
      options.setUploadProgress,
      options.setUploadState,
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
      await runMutation(async () => {
        const baseRevision = await options.flushLayerReview();
        const result =
          input.operation === "split"
            ? await splitPdfTextLayer(source.projectId, {
                sourceVersionId: source.sourceVersionId,
                baseRevision,
                layerId: operation.layerIds[0]!,
                offset: input.offset,
              })
            : await mergePdfTextLayers(source.projectId, {
                sourceVersionId: source.sourceVersionId,
                baseRevision,
                layerIds: operation.layerIds,
                separator: input.separator,
              });
        const preferredLayerId =
          result.createdLayerIds[0] ??
          result.affectedLayerIds.find((id) =>
            result.document.layers.some((layer) => layer.id === id),
          );
        await options.adoptDocument(result.document, preferredLayerId);
        options.onNotify(
          input.operation === "split"
            ? "تم تقسيم الوحدة النصية وحفظ مراجعة قابلة للتراجع."
            : "تم دمج الوحدات النصية وحفظ مراجعة قابلة للتراجع.",
        );
      });
    },
    [
      options.adoptDocument,
      options.flushLayerReview,
      options.onNotify,
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
      await runMutation(async () => {
        const baseRevision = await options.flushLayerReview();
        const document = await runPdfRegionOcr(
          source.projectId,
          {
            sourceVersionId: source.sourceVersionId,
            baseRevision,
            pageNumber: layer.pageNumber!,
            start,
            end,
          },
          { onProgress: options.setUploadProgress },
        );
        await options.adoptDocument(document);
        options.onNotify(
          "اكتمل OCR الإقليمي وحُفظ النص الجديد كمراجعة قابلة للتراجع.",
        );
      });
    },
    [
      options.adoptDocument,
      options.flushLayerReview,
      options.onNotify,
      options.pdfRegionOcrLayer,
      options.pdfRegionOcrPageSize,
      options.projectId,
      options.setUploadProgress,
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
      await runMutation(async () => {
        const baseRevision = await options.flushLayerReview();
        const result =
          input.operation === "edge-refine"
            ? await refineImageLayerEdges(source.projectId, {
                sourceVersionId: source.sourceVersionId,
                baseRevision,
                layerId: operation.layerIds[0]!,
                radius: input.radius,
                strength: input.strength,
              })
            : await mergeImageLayers(source.projectId, {
                sourceVersionId: source.sourceVersionId,
                baseRevision,
                layerIds: operation.layerIds,
              });
        await options.adoptDocument(
          result.document,
          result.createdLayerIds[0] ?? result.affectedLayerIds[0],
        );
        options.onNotify(
          input.operation === "edge-refine"
            ? "تم تحسين الحواف وحفظ أصل Raster جديد قابل للتراجع."
            : "تم دمج طبقات Raster وحفظ الناتج كمراجعة قابلة للتراجع.",
        );
      });
    },
    [
      options.adoptDocument,
      options.flushLayerReview,
      options.imageRasterOperation,
      options.onNotify,
      options.projectId,
      options.sourceVersionId,
      runMutation,
    ],
  );

  return {
    applyImageRasterOperation,
    applyPdfRegionOcr,
    applyPdfTextOperation,
  };
}
