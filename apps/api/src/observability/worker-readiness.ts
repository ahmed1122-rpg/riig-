import type {
  OperationalStatusProvider,
  OperationalStatusSnapshot,
  WorkerStatus,
} from "./operational-status.js";

export function hasLiveWorker(
  snapshot: OperationalStatusSnapshot,
  workerType: WorkerStatus["workerType"],
  expectedReleaseVersion?: string,
): boolean {
  const liveWorkers = snapshot.workers.filter(
    (worker) => worker.workerType === workerType && !worker.stale,
  );
  return (
    liveWorkers.length > 0 &&
    (expectedReleaseVersion === undefined ||
      liveWorkers.every(
        (worker) => worker.releaseVersion === expectedReleaseVersion,
      ))
  );
}

export async function assertLiveWorker(
  provider: OperationalStatusProvider,
  workerType: WorkerStatus["workerType"],
  expectedReleaseVersion?: string,
): Promise<void> {
  const snapshot = await provider.snapshot();
  if (!hasLiveWorker(snapshot, workerType, expectedReleaseVersion)) {
    const releaseRequirement = expectedReleaseVersion
      ? ` or does not match release ${expectedReleaseVersion}`
      : "";
    throw new Error(
      `Required ${workerType} worker heartbeat is missing or stale${releaseRequirement}.`,
    );
  }
}
