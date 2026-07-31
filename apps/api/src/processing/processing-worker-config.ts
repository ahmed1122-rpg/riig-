import { z } from "zod";
import { createWorkerEnvironmentSchema } from "../storage/object-storage-environment.js";

const configSchema = createWorkerEnvironmentSchema({
  PROCESSING_POLL_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(30_000)
    .default(1_000),
  PROCESSING_LEASE_MS: z.coerce
    .number()
    .int()
    .min(30_000)
    .max(30 * 60_000)
    .default(5 * 60_000),
  PROCESSING_DRAIN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(2 * 60_000)
    .default(30_000),
  PROCESSING_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  DOCUMENT_PROCESSING_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(1)
    .max(4)
    .default(1),
  SHARP_CACHE_MEMORY_MB: z.coerce.number().int().min(0).max(512).default(64),
  SHARP_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  USAGE_METERING_MODE: z
    .enum(["off", "shadow", "soft", "hard-jobs", "hard"])
    .default("shadow"),
  PDF_OCR_MODE: z.enum(["disabled", "local"]).default("local"),
});

export function loadProcessingWorkerConfig(environment: NodeJS.ProcessEnv) {
  return configSchema.parse(environment);
}
