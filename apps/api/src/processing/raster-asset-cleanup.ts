import type { ObjectStorage } from "../storage/object-storage.js";

export async function cleanupRasterAssets(
  storage: ObjectStorage,
  objectKeys: readonly string[],
  onError?: (error: unknown, objectKey: string) => void,
): Promise<void> {
  const results = await Promise.allSettled(
    objectKeys.map((objectKey) => storage.delete(objectKey)),
  );
  results.forEach((result, index) => {
    if (result.status !== "rejected") return;
    try {
      onError?.(result.reason, objectKeys[index]!);
    } catch {
      // Cleanup observability must never replace the authoritative failure.
    }
  });
}
