export interface WorkerStatus {
  instanceId: string;
  workerType: "media" | "document" | "export";
  releaseVersion: string;
  concurrency: number;
  lastSeenAt: string;
  stale: boolean;
}

export interface QueueStatus {
  queue: "processing-media" | "processing-document" | "export";
  queued: number;
  active: number;
  failed: number;
  oldestQueuedSeconds: number;
  retriesLastHour: number;
  leaseLossesLastHour: number;
  duration: {
    count: number;
    sumSeconds: number;
    buckets: number[];
  };
}

export const jobDurationBuckets = [1, 5, 15, 30, 60, 120, 300, 600] as const;

export interface OperationalStatusSnapshot {
  status: "ready" | "degraded";
  workers: WorkerStatus[];
  queues: QueueStatus[];
  maintenance: {
    task: "retention";
    lastStartedAt: string | null;
    lastSucceededAt: string | null;
    lastFailedAt: string | null;
    lastError: string | null;
    stale: boolean;
  } | null;
  checkedAt: string;
}

export interface OperationalStatusProvider {
  snapshot(): Promise<OperationalStatusSnapshot>;
}
