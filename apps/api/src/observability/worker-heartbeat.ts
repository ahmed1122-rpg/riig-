import type { Pool } from "pg";

export interface WorkerHeartbeat {
  stop(): Promise<void>;
}

export async function startWorkerHeartbeat(
  pool: Pool,
  input: {
    instanceId: string;
    workerType: "media" | "document" | "export";
    releaseVersion: string;
    concurrency: number;
    onError?: (error: unknown) => void;
  },
  intervalMs = 10_000,
): Promise<WorkerHeartbeat> {
  let stopped = false;
  let writing = false;
  const write = async () => {
    if (stopped || writing) return;
    writing = true;
    try {
      await pool.query(
        `INSERT INTO worker_heartbeats (
           instance_id, worker_type, release_version, concurrency,
           started_at, last_seen_at
         )
         VALUES ($1, $2, $3, $4, now(), now())
         ON CONFLICT (instance_id) DO UPDATE SET
           release_version = EXCLUDED.release_version,
           concurrency = EXCLUDED.concurrency,
           last_seen_at = now()`,
        [
          input.instanceId,
          input.workerType,
          input.releaseVersion,
          input.concurrency,
        ],
      );
    } finally {
      writing = false;
    }
  };
  await write();
  const timer = setInterval(() => {
    void write().catch((error: unknown) => input.onError?.(error));
  }, intervalMs);
  timer.unref();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      while (writing) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
}
