import type { PreparedRasterAsset } from "@motionprep/media-processing";
import type { ObjectStorage } from "../storage/object-storage.js";
import { cleanupRasterAssets } from "./raster-asset-cleanup.js";

const DEFAULT_WRITE_CONCURRENCY = 2;
const MAX_WRITE_CONCURRENCY = 4;

export interface RasterAssetWriteObservation {
  assetCount: number;
  storedCount: number;
  totalBytes: number;
  durationMs: number;
  concurrency: number;
  outcome: "succeeded" | "failed";
}

export interface RasterAssetWriteOptions {
  concurrency?: number;
  assertCanContinue?: () => void;
  onCleanupError?: (error: unknown, objectKey: string) => void;
  onObservation?: (observation: RasterAssetWriteObservation) => void;
  onObservationError?: (error: unknown) => void;
}

export async function writeRasterAssets(
  storage: ObjectStorage,
  assets: readonly PreparedRasterAsset[],
  options: RasterAssetWriteOptions = {},
): Promise<string[]> {
  const concurrency = normalizeConcurrency(options.concurrency);
  const storedObjectKeys: string[] = [];
  const startedAt = performance.now();
  let outcome: RasterAssetWriteObservation["outcome"] = "failed";

  try {
    for (let index = 0; index < assets.length; index += concurrency) {
      options.assertCanContinue?.();
      const batch = assets.slice(index, index + concurrency);
      const results = await Promise.allSettled(
        batch.map(async (asset) => {
          await storage.put({
            key: asset.objectKey,
            body: asset.body,
            contentType: asset.contentType,
            sizeBytes: asset.sizeBytes,
          });
          return asset.objectKey;
        }),
      );
      results.forEach((result) => {
        if (result.status === "fulfilled") {
          storedObjectKeys.push(result.value);
        }
      });
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failure) throw failure.reason;
      options.assertCanContinue?.();
    }
    outcome = "succeeded";
    return storedObjectKeys;
  } catch (error) {
    await cleanupRasterAssets(
      storage,
      storedObjectKeys,
      options.onCleanupError,
    );
    throw error;
  } finally {
    reportObservation(options, {
      assetCount: assets.length,
      storedCount: storedObjectKeys.length,
      totalBytes: assets.reduce((total, asset) => total + asset.sizeBytes, 0),
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      concurrency,
      outcome,
    });
  }
}

function normalizeConcurrency(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || value === undefined) {
    return DEFAULT_WRITE_CONCURRENCY;
  }
  return Math.min(MAX_WRITE_CONCURRENCY, Math.max(1, value));
}

function reportObservation(
  options: RasterAssetWriteOptions,
  observation: RasterAssetWriteObservation,
): void {
  try {
    options.onObservation?.(observation);
  } catch (error) {
    try {
      options.onObservationError?.(error);
    } catch {
      // Observability must never replace the authoritative storage outcome.
    }
  }
}
