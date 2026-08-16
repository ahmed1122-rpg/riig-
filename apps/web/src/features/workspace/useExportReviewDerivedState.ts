import { useMemo } from "react";
import {
  exportFormatsByProjectKind,
  type ExportFormat,
  type ProductionIssue,
} from "@motionprep/contracts";
import type { Layer, ProjectMode } from "../../types";
import { getExportFormatPresentation } from "../../shared/exportPresentation";
import { evaluateExportPreflight } from "./exportPreflight";
import { reviewableExportLayers, selectedExportLayer } from "./exportReviewLayers";
import type { ExportGenerationState } from "./exportFormatState";
import type { FormatOption } from "./exportReviewTypes";
import type { WorkspaceSaveState } from "./WorkspaceChrome";
import { isPageLayer } from "./workspaceLayerKinds";

export function useExportReviewDerivedState(
  mode: ProjectMode,
  layers: Layer[],
  selectedLayerId: string,
  generationMessage: string | undefined,
  generationState: ExportGenerationState,
  generationIssues: readonly ProductionIssue[],
  format: ExportFormat,
  canExport: boolean,
  saveState: WorkspaceSaveState,
  canvasSize: { width: number; height: number } | undefined,
  pdfPages: Array<{ pageNumber: number; width: number; height: number }> | undefined,
) {
  const reviewableLayers = useMemo(
    () => reviewableExportLayers(layers),
    [layers],
  );
  const selected = useMemo(
    () => selectedExportLayer(reviewableLayers, selectedLayerId),
    [selectedLayerId, reviewableLayers],
  );
  const formats = useMemo<FormatOption[]>(
    () =>
      exportFormatsByProjectKind[mode].map((id) => {
        const presentation = getExportFormatPresentation(id, mode);
        return { id, title: presentation.label, hint: presentation.hint };
      }),
    [mode],
  );
  const preflight = useMemo(
    () => evaluateExportPreflight({
      mode,
      layers,
      canExport,
      saveState,
      ...(canvasSize ? { canvasSize } : {}),
      ...(pdfPages ? { pdfPages } : {}),
    }),
    [canExport, canvasSize, layers, mode, pdfPages, saveState],
  );
  const footerIssues = useMemo(() => {
    const findings = [
      ...preflight.findings
        .filter(({ severity }) => severity === "blocked")
        .map(({ key, message }) => ({ key, message })),
      ...generationIssues.map((issue, index) => ({
        key: `server:${issue.code}:${issue.layerId ?? issue.pageNumber ?? index}`,
        message: issue.message,
      })),
    ];
    return [...new Map(findings.map((finding) => [finding.message, finding])).values()];
  }, [generationIssues, preflight.findings]);

  return {
    reviewableLayers,
    selected,
    formats,
    selectedFormat: formats.find((item) => item.id === format),
    displayedGenerationMessage:
      generationMessage ??
      (generationState === "done"
        ? getExportFormatPresentation(format, mode).successMessage
        : undefined),
    fixedBackground: Boolean(
      selected?.fixed || (mode === "book" && selected && isPageLayer(selected)),
    ),
    pageCount: Math.max(1, ...layers.map((layer) => layer.pageNumber ?? 1)),
    preflight,
    footerIssues,
  };
}
