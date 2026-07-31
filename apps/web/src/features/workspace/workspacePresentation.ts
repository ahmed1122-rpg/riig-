import type { PdfSegmentation, ProjectMode } from "../../types";
import { pdfSegmentationLabels } from "./pdfSegmentation";

export type WorkspaceExportFormat =
  | "psd"
  | "tiff"
  | "png-zip"
  | "png-files"
  | "txt"
  | "csv"
  | "json";

export function getWorkspacePipeline(
  mode: ProjectMode,
  sourceVersion: number,
  imageLayerCount: number,
  pdfMode: PdfSegmentation,
) {
  const sourceOutput =
    sourceVersion > 0 ? `نسخة v${sourceVersion}` : "بانتظار الرفع";

  return mode === "image"
    ? [
        { name: "المصدر", output: sourceOutput },
        { name: "التقطيع", output: `${imageLayerCount} / 15 طبقة` },
        { name: "المراجعة", output: "مراجعة القناع" },
        { name: "التصدير", output: "PSD لـ Adobe" },
      ]
    : [
        { name: "المصدر", output: sourceOutput },
        { name: "التقطيع", output: pdfSegmentationLabels[pdfMode] },
        { name: "المراجعة", output: "ترتيب القراءة" },
        { name: "التصدير", output: "PSD لكل صفحة" },
      ];
}

export function toApiExportFormat(format: WorkspaceExportFormat) {
  return format === "png-zip"
    ? "png-layers-json"
    : format === "png-files"
      ? "transparent-pngs"
      : format === "tiff"
        ? "layered-tiff"
        : format;
}
