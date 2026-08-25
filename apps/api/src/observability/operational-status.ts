export interface WorkerStatus {
  instanceId: string;
  workerType: "media" | "document" | "export" | "character" | "security";
  releaseVersion: string;
  concurrency: number;
  residentMemoryBytes: number;
  heapUsedBytes: number;
  cpuUserSeconds: number;
  cpuSystemSeconds: number;
  lastSeenAt: string;
  stale: boolean;
}

export interface QueueStatus {
  queue:
    | "processing-media"
    | "processing-document"
    | "export"
    | "character"
    | "malware-scan";
  queued: number;
  active: number;
  failed: number;
  oldestQueuedSeconds: number;
  retriesLastHour: number;
  failuresLastHour: number;
  completionsLastHour: number;
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
  emailOutbox: {
    queued: number;
    sending: number;
    failed: number;
    oldestQueuedSeconds: number;
    retriesLastHour: number;
    failuresLastHour: number;
  } | null;
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
