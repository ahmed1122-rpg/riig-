import type { Pool } from "pg";
import { readFile, unlink, writeFile } from "node:fs/promises";

export interface WorkerHeartbeat {
  stop(): Promise<void>;
}

export async function startWorkerHeartbeat(
  pool: Pool,
  input: {
    instanceId: string;
    workerType: "media" | "document" | "export" | "character" | "security";
    releaseVersion: string;
    concurrency: number;
    healthInstanceFile?: string;
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
      const memory = process.memoryUsage();
      const cpu = process.cpuUsage();
      await pool.query(
        `INSERT INTO worker_heartbeats (
           instance_id, worker_type, release_version, concurrency,
           resident_memory_bytes, heap_used_bytes,
           cpu_user_microseconds, cpu_system_microseconds,
           started_at, last_seen_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
         ON CONFLICT (instance_id) DO UPDATE SET
           release_version = EXCLUDED.release_version,
           concurrency = EXCLUDED.concurrency,
           resident_memory_bytes = EXCLUDED.resident_memory_bytes,
           heap_used_bytes = EXCLUDED.heap_used_bytes,
           cpu_user_microseconds = EXCLUDED.cpu_user_microseconds,
           cpu_system_microseconds = EXCLUDED.cpu_system_microseconds,
           last_seen_at = now()`,
        [
          input.instanceId,
          input.workerType,
          input.releaseVersion,
          input.concurrency,
          memory.rss,
          memory.heapUsed,
          cpu.user,
          cpu.system,
        ],
      );
    } finally {
      writing = false;
    }
  };
  await write();
  if (input.healthInstanceFile) {
    await writeFile(input.healthInstanceFile, `${input.instanceId}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
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
      if (input.healthInstanceFile) {
        await removeOwnedInstanceFile(
          input.healthInstanceFile,
          input.instanceId,
        );
      }
    },
  };
}

async function removeOwnedInstanceFile(
  filePath: string,
  instanceId: string,
): Promise<void> {
  try {
    if ((await readFile(filePath, "utf8")).trim() === instanceId) {
      await unlink(filePath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
