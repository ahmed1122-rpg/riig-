import type { ExportFormat, ProjectKind } from "@motionprep/contracts";

interface ExportFormatPresentation {
  label: string;
  hint: string;
  successMessage: string;
}

const commonPresentation: Record<ExportFormat, ExportFormatPresentation> = {
  psd: {
    label: "PSD بطبقات",
    hint: "RGB/8-bit مع طبقات Raster",
    successMessage: "تم إنشاء ملف PSD وتنزيله.",
  },
  "png-layers-json": {
    label: "PNG + JSON",
    hint: "المصدر وملف Manifest داخل ZIP",
    successMessage: "تم إنشاء حزمة PNG + JSON وتنزيلها.",
  },
  "layered-tiff": {
    label: "TIFF متعدد الصفحات",
    hint: "صفحة كاملة المساحة لكل طبقة Raster",
    successMessage: "تم إنشاء ملف TIFF متعدد الصفحات وتنزيله.",
  },
  "transparent-pngs": {
    label: "PNG شفافة",
    hint: "PNG كاملة المساحة لكل طبقة",
    successMessage: "تم إنشاء حزمة PNG الشفافة وتنزيلها.",
  },
  txt: {
    label: "TXT",
    hint: "النص المستخرج",
    successMessage: "تم إنشاء ملف TXT وتنزيله.",
  },
  csv: {
    label: "CSV",
    hint: "الوحدات والمواضع",
    successMessage: "تم إنشاء ملف CSV وتنزيله.",
  },
  json: {
    label: "JSON",
    hint: "وثيقة الطبقات الكاملة",
    successMessage: "تم إنشاء ملف JSON وتنزيله.",
  },
};

export function getExportFormatPresentation(
  format: ExportFormat,
  projectKind?: ProjectKind,
): ExportFormatPresentation {
  if (projectKind === "book" && format === "psd") {
    return {
      ...commonPresentation.psd,
      hint: "طبقات نص Raster مستقلة وخلفية بيضاء ثابتة",
    };
  }
  if (projectKind === "book" && format === "png-layers-json") {
    return {
      ...commonPresentation["png-layers-json"],
      hint: "المصدر والخلفيات والمواضع داخل ZIP",
    };
  }
  return commonPresentation[format];
}
