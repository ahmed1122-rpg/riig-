import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Layer, ProjectMode } from "../../types";
import type { LayerDocumentView } from "../../lib/api";
import {
  loadRasterLayerPreviews,
  toWorkspaceLayers,
} from "./workspaceDocument";

interface WorkspaceDocumentAdoptionOptions {
  mode: ProjectMode;
  projectId?: string;
  activePdfPage: number;
  activeLayerId: string;
  replaceLayerAssetUrls: (urls: string[]) => void;
  applyPreparedDocument: (
    document: LayerDocumentView,
    layers: Layer[],
    pdfPageNumber?: number,
  ) => void;
  adoptSavedReview: (layers: Layer[], revision: number) => void;
  setGuidanceRevision: Dispatch<SetStateAction<number>>;
  setActiveLayerId: Dispatch<SetStateAction<string>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
}

export function useWorkspaceDocumentAdoption(
  options: WorkspaceDocumentAdoptionOptions,
) {
  return useCallback(
    async (
      document: LayerDocumentView,
      preferredLayerId?: string,
    ): Promise<void> => {
      const previewResult =
        options.mode === "image" &&
        document.sourceVersionId &&
        options.projectId
          ? await loadRasterLayerPreviews(
              options.projectId,
              document.sourceVersionId,
              document,
            )
          : { previews: new Map<string, string>(), urls: [] };
      options.replaceLayerAssetUrls(previewResult.urls);
      const preparedLayers = toWorkspaceLayers(
        document,
        options.mode,
        previewResult.previews,
      );
      options.applyPreparedDocument(
        document,
        preparedLayers,
        options.activePdfPage,
      );
      options.adoptSavedReview(preparedLayers, document.revision ?? 1);
      options.setGuidanceRevision(document.guidance?.revision ?? 0);
      const nextActiveId =
        preferredLayerId &&
        preparedLayers.some((layer) => layer.id === preferredLayerId)
          ? preferredLayerId
          : preparedLayers.some(
                (layer) => layer.id === options.activeLayerId,
              )
            ? options.activeLayerId
            : preparedLayers[0]?.id ?? "";
      options.setActiveLayerId(nextActiveId);
      options.setSelectedIds(nextActiveId ? [nextActiveId] : []);
    },
    [
      options.activeLayerId,
      options.activePdfPage,
      options.adoptSavedReview,
      options.applyPreparedDocument,
      options.mode,
      options.projectId,
      options.replaceLayerAssetUrls,
      options.setActiveLayerId,
      options.setGuidanceRevision,
      options.setSelectedIds,
    ],
  );
}
