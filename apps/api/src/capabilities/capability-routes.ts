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
  maxImageUploadBytes: number;
  storageProfile: "ephemeral" | "durable";
  pdfRegionOcrEnabled: boolean;
  characterRigEnabled: boolean;
  operationalStatus?: OperationalStatusProvider;
  requiredWorkers: ReadonlySet<
    "media" | "document" | "export" | "character" | "security"
  >;
}

export async function registerCapabilityRoutes(
  app: FastifyInstance,
  options: CapabilityRouteOptions,
): Promise<void> {
  const buildCapabilities = async (): Promise<ApplicationCapabilities> => {
    const workers = await resolveWorkerCapabilities(options);
    const characterRigAvailable =
      options.characterRigEnabled && workers.character.status === "ready";
    return {
      schemaVersion: APPLICATION_CAPABILITIES_SCHEMA_VERSION,
      limits: {
        maxUploadBytes: options.maxUploadBytes,
        maxImageUploadBytes: Math.min(
          options.maxImageUploadBytes,
          options.maxUploadBytes,
        ),
        maxPdfUploadBytes: options.maxUploadBytes,
        maxPdfPages: MAX_PDF_PAGES,
        maxPdfTextItems: MAX_PDF_TEXT_ITEMS,
        maxImageLayers: MAX_IMAGE_LAYERS,
      },
      runtime: { storageProfile: options.storageProfile, workers },
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

async function resolveWorkerCapabilities(
  options: CapabilityRouteOptions,
): Promise<ApplicationCapabilities["runtime"]["workers"]> {
  const workerTypes = [
    "media",
    "document",
    "export",
    "character",
    "security",
  ] as const;
  let snapshot: Awaited<ReturnType<OperationalStatusProvider["snapshot"]>> | null = null;
  try {
    snapshot = options.operationalStatus
      ? await options.operationalStatus.snapshot()
      : null;
  } catch {
    snapshot = null;
  }
  return Object.fromEntries(
    workerTypes.map((workerType) => {
      if (!options.requiredWorkers.has(workerType)) {
        return [workerType, { status: "not_required", reason: null }];
      }
      const ready = options.operationalStatus
        ? snapshot
          ? hasLiveWorker(snapshot, workerType)
          : false
        : true;
      return [
        workerType,
        ready
          ? { status: "ready", reason: null }
          : {
              status: "degraded",
              reason: `Required ${workerType} worker heartbeat is missing or stale.`,
            },
      ];
    }),
  ) as ApplicationCapabilities["runtime"]["workers"];
}
