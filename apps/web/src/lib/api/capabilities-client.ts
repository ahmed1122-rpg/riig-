import type { ApplicationCapabilities } from "@motionprep/contracts";
import { request } from "./transport";

export type { ApplicationCapabilities } from "@motionprep/contracts";

export const unavailableApplicationCapabilities: ApplicationCapabilities = {
  schemaVersion: "1.0",
  limits: {
    maxUploadBytes: 0,
    maxPdfPages: 0,
    maxPdfTextItems: 0,
    maxImageLayers: 0,
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
