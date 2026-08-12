import type { PreparedRasterAsset } from "@motionprep/media-processing";
import type { ObjectStorage } from "../storage/object-storage.js";
import { writeRasterAssets } from "./raster-asset-writer.js";
import type { DerivedAssetRegistry } from "../storage/derived-asset-registry.js";

interface ProcessingRasterAssetWriteContext {
  storage: ObjectStorage;
  rasterAssetWriteConcurrency: number;
  derivedAssets?: DerivedAssetRegistry;
  log: (
    level: "info" | "warning" | "error",
    message: string,
    context: Record<string, unknown>,
  ) => void;
}

export function writeProcessingRasterAssets(
  context: ProcessingRasterAssetWriteContext,
  jobId: string,
  projectId: string,
  assets: readonly PreparedRasterAsset[],
  assertCanContinue: () => void,
): Promise<string[]> {
  const derivedAssets = context.derivedAssets;
  return writeRasterAssets(context.storage, assets, {
    concurrency: context.rasterAssetWriteConcurrency,
    ...(derivedAssets
      ? {
          beforeStore: (objectKey: string) =>
            derivedAssets.register(
              projectId,
              objectKey,
              "processing",
            ),
        }
      : {}),
    assertCanContinue,
    onCleanupError: (error, objectKey) => {
      context.log("error", "processing.asset_cleanup_failed", {
        job_id: jobId,
        object_key: objectKey,
        error: error instanceof Error ? error.message : "unknown",
      });
    },
    onObservation: (observation) => {
      context.log(
        observation.outcome === "succeeded" ? "info" : "warning",
        "processing.raster_asset_write_observed",
        {
          job_id: jobId,
          asset_count: observation.assetCount,
          stored_count: observation.storedCount,
          total_bytes: observation.totalBytes,
          duration_ms: observation.durationMs,
          concurrency: observation.concurrency,
          outcome: observation.outcome,
        },
      );
    },
    onObservationError: (error) => {
      context.log("error", "processing.raster_asset_observer_failed", {
        job_id: jobId,
        error: error instanceof Error ? error.message : "unknown",
      });
    },
  });
}
