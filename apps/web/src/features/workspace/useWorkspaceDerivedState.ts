import { useMemo } from "react";
import type { Layer, PdfSegmentation, ProjectMode } from "../../types";
import { getLayerCheckSummary } from "./layerChecks";
import { getWorkspacePipeline } from "./workspacePresentation";

export function getWorkspaceMaxUploadBytes(
  mode: ProjectMode,
  limits: { maxImageUploadBytes: number; maxPdfUploadBytes: number },
): number {
  return mode === "image" ? limits.maxImageUploadBytes : limits.maxPdfUploadBytes;
}

export function useWorkspaceDerivedState(
  mode: ProjectMode,
  layers: Layer[],
  imageLayers: Layer[],
  bookLayers: Layer[],
  pdfPages: Array<{ pageNumber: number; width: number; height: number }>,
  pdfRegionOcrLayerId: string | undefined,
  solo: boolean,
  activeLayerId: string,
  sourceVersion: number,
  pdfMode: PdfSegmentation,
) {
  const pdfRegionOcrLayer = bookLayers.find(({ id }) => id === pdfRegionOcrLayerId);
  const pdfRegionOcrPageSize = pdfPages.find(
    ({ pageNumber }) => pageNumber === pdfRegionOcrLayer?.pageNumber,
  );
  const layerCheckSummary = useMemo(
    () => getLayerCheckSummary(mode, layers),
    [layers, mode],
  );
  const hiddenLayers = useMemo(
    () => imageLayers
      .filter((layer) => !layer.visible || (solo && layer.id !== activeLayerId))
      .map(({ id }) => id),
    [activeLayerId, imageLayers, solo],
  );
  return {
    pdfRegionOcrLayer,
    pdfRegionOcrPageSize,
    layerCheckSummary,
    hiddenLayers,
    pipeline: getWorkspacePipeline(
      mode,
      sourceVersion,
      imageLayers.length,
      pdfMode,
    ),
  };
}
