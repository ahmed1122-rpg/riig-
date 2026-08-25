import type { AppDependencies } from "./app-dependencies.js";
import type { AppConfig } from "./config.js";

export function assertProductionDependencies(
  config: Pick<
    AppConfig,
    "NODE_ENV" | "PAYMENT_MODE" | "CHARACTER_RIG_ENABLED" | "MALWARE_SCAN_MODE"
  >,
  dependencies: AppDependencies,
): void {
  if (config.NODE_ENV !== "production") return;
  const required: Array<keyof AppDependencies> = [
    "projects",
    "projectReviews",
    "uploads",
    "uploadFinalization",
    "uploadIntegrityFailures",
    "uploadCancellations",
    "sourceVersions",
    "sourceVersionRestores",
    "exports",
    "auth",
    "audit",
    "billing",
    "idempotency",
    "loginAttempts",
    "objectStorage",
    "processingJobs",
    "layerDocuments",
    "emailSender",
    "secretProtector",
    "readiness",
    "dependencyReadiness",
    "adminAccess",
    "usageMeter",
    "operationalStatus",
    "rateLimitStore",
    "accountPrivacy",
    "derivedAssets",
    ...(config.MALWARE_SCAN_MODE === "required"
      ? (["uploadScanQueue"] as const)
      : []),
    ...(config.CHARACTER_RIG_ENABLED
      ? (["characterRigs", "characterJobs"] as const)
      : []),
    ...(config.PAYMENT_MODE === "live"
      ? (["paymentProviders"] as const)
      : []),
  ];
  const missing = required.filter((key) => dependencies[key] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Production dependency wiring is incomplete: ${missing.join(", ")}.`,
    );
  }
}
