import type { FastifyInstance } from "fastify";
import {
  APPLICATION_CAPABILITIES_SCHEMA_VERSION,
  MAX_IMAGE_LAYERS,
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_ITEMS,
  type ApplicationCapabilities,
} from "@motionprep/contracts";
import type { OperationalStatusProvider } from "../observability/operational-status.js";
import { hasLiveWorker } from "../observability/worker-readiness.js";

interface CapabilityRouteOptions {
  maxUploadBytes: number;
  pdfRegionOcrEnabled: boolean;
  characterRigEnabled: boolean;
  operationalStatus?: OperationalStatusProvider;
}

export async function registerCapabilityRoutes(
  app: FastifyInstance,
  options: CapabilityRouteOptions,
): Promise<void> {
  const buildCapabilities = async (): Promise<ApplicationCapabilities> => {
    const characterRigAvailable = await resolveCharacterRigAvailability(options);
    return {
      schemaVersion: APPLICATION_CAPABILITIES_SCHEMA_VERSION,
      limits: {
        maxUploadBytes: options.maxUploadBytes,
        maxPdfPages: MAX_PDF_PAGES,
        maxPdfTextItems: MAX_PDF_TEXT_ITEMS,
        maxImageLayers: MAX_IMAGE_LAYERS,
      },
      features: {
        characterRig: {
          enabled: characterRigAvailable,
          unavailableReason: characterRigAvailable
            ? null
            : options.characterRigEnabled
              ? "Character Studio is configured, but its worker heartbeat is missing or stale."
              : "Character Studio is disabled until its private inference worker and release Golden are configured.",
          requiredCanonicalViews: 5,
          supportedProjectKinds: ["image"],
        },
        pdfRegionOcr: {
          enabled: options.pdfRegionOcrEnabled,
          unavailableReason: options.pdfRegionOcrEnabled
            ? null
            : "إعادة OCR لمنطقة محددة غير مفعّلة في بيئة التشغيل الحالية.",
        },
      },
    };
  };

  app.get(
    "/v1/capabilities",
    {
      schema: {
        tags: ["system"],
        summary: "Public runtime capabilities and enforced limits",
      },
    },
    async () => ({ data: await buildCapabilities(), error: null }),
  );
}

async function resolveCharacterRigAvailability(
  options: CapabilityRouteOptions,
): Promise<boolean> {
  if (!options.characterRigEnabled) return false;
  if (!options.operationalStatus) return true;
  try {
    return hasLiveWorker(await options.operationalStatus.snapshot(), "character");
  } catch {
    return false;
  }
}
