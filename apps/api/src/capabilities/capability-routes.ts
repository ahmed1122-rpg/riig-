import type { FastifyInstance } from "fastify";
import {
  APPLICATION_CAPABILITIES_SCHEMA_VERSION,
  MAX_IMAGE_LAYERS,
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_ITEMS,
  type ApplicationCapabilities,
} from "@motionprep/contracts";

interface CapabilityRouteOptions {
  maxUploadBytes: number;
  pdfRegionOcrEnabled: boolean;
  characterRigEnabled: boolean;
}

export async function registerCapabilityRoutes(
  app: FastifyInstance,
  options: CapabilityRouteOptions,
): Promise<void> {
  const capabilities: ApplicationCapabilities = {
    schemaVersion: APPLICATION_CAPABILITIES_SCHEMA_VERSION,
    limits: {
      maxUploadBytes: options.maxUploadBytes,
      maxPdfPages: MAX_PDF_PAGES,
      maxPdfTextItems: MAX_PDF_TEXT_ITEMS,
      maxImageLayers: MAX_IMAGE_LAYERS,
    },
    features: {
      characterRig: {
        enabled: options.characterRigEnabled,
        unavailableReason: options.characterRigEnabled
          ? null
          : "Character Studio is disabled until its private inference worker and release Golden are configured.",
        requiredCanonicalViews: 5,
      },
      pdfRegionOcr: {
        enabled: options.pdfRegionOcrEnabled,
        unavailableReason: options.pdfRegionOcrEnabled
          ? null
          : "إعادة OCR لمنطقة محددة غير مفعلة في بيئة التشغيل الحالية.",
      },
    },
  };

  app.get(
    "/v1/capabilities",
    {
      schema: {
        tags: ["system"],
        summary: "Public runtime capabilities and enforced limits",
      },
    },
    async () => ({ data: capabilities, error: null }),
  );
}
