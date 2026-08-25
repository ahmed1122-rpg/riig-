import type { ApplicationCapabilities } from "@motionprep/contracts";
import { request } from "./transport";

export type { ApplicationCapabilities } from "@motionprep/contracts";

export const unavailableApplicationCapabilities: ApplicationCapabilities = {
  schemaVersion: "1.2",
  limits: {
    maxUploadBytes: 0,
    maxImageUploadBytes: 0,
    maxPdfUploadBytes: 0,
    maxPdfPages: 0,
    maxPdfTextItems: 0,
    maxImageLayers: 0,
  },
  runtime: {
    storageProfile: "unknown",
    workers: {
      media: { status: "degraded", reason: "تعذر التحقق من عامل الصور." },
      document: { status: "degraded", reason: "تعذر التحقق من عامل المستندات." },
      export: { status: "degraded", reason: "تعذر التحقق من عامل التصدير." },
      character: { status: "degraded", reason: "تعذر التحقق من عامل الشخصيات." },
      security: { status: "degraded", reason: "تعذر التحقق من عامل فحص الملفات." },
    },
  },
  features: {
    characterRig: {
      enabled: false,
      unavailableReason:
        "تعذر التحقق من جاهزية Character Studio؛ أوقفت الميزة لحماية بيانات الشخصية.",
      requiredCanonicalViews: 5,
      supportedProjectKinds: ["image"],
    },
    pdfRegionOcr: {
      enabled: false,
      unavailableReason:
        "تعذر التحقق من قدرات الخادم؛ أُوقفت الأداة مؤقتًا لحماية المستند.",
    },
  },
};

export function getApplicationCapabilities(): Promise<ApplicationCapabilities> {
  return request<ApplicationCapabilities>("/v1/capabilities");
}
