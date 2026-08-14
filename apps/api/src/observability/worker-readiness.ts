import type {
  OperationalStatusProvider,
  OperationalStatusSnapshot,
  WorkerStatus,
} from "./operational-status.js";

export function hasLiveWorker(
  snapshot: OperationalStatusSnapshot,
  workerType: WorkerStatus["workerType"],
): boolean {
  return snapshot.workers.some(
    (worker) => worker.workerType === workerType && !worker.stale,
  );
}

export async function assertLiveWorker(
  provider: OperationalStatusProvider,
  workerType: WorkerStatus["workerType"],
): Promise<void> {
  const snapshot = await provider.snapshot();
  if (!hasLiveWorker(snapshot, workerType)) {
    throw new Error(`Required ${workerType} worker heartbeat is missing or stale.`);
  }
}
