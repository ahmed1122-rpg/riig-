import type { PdfSegmentation, ProjectMode } from "../../types";
import { MAX_IMAGE_LAYERS } from "@motionprep/contracts";
import { pdfSegmentationLabels } from "../../shared/pdfSegmentation";

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
        {
          name: "التقطيع",
          output: `${imageLayerCount} / ${MAX_IMAGE_LAYERS} طبقة`,
        },
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
