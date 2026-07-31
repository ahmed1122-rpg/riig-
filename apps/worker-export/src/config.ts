import { createWorkerEnvironmentSchema } from "@motionprep/api/object-storage-environment";
import { z } from "zod";

const configSchema = createWorkerEnvironmentSchema({
  EXPORT_POLL_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(30_000)
    .default(1_000),
  EXPORT_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  SHARP_CACHE_MEMORY_MB: z.coerce.number().int().min(0).max(512).default(64),
  SHARP_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  EXPORT_LEASE_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(30 * 60_000)
    .default(5 * 60_000),
  EXPORT_DRAIN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(2 * 60_000)
    .default(30_000),
  EXPORT_WORKER_ID: z.string().trim().min(3).optional(),
});

export function loadExportWorkerConfig(environment: NodeJS.ProcessEnv) {
  return configSchema.parse(environment);
}
